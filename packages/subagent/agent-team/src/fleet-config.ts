/**
 * Repository fleet configuration and its one-time approval record. A fleet
 * file is untrusted repository content: it is size-capped, parsed as strict
 * JSON, limited to in-process providers, and may launch only after a fresh
 * approval keyed by the exact file bytes and the canonical repository path.
 * @module @greeneek/gnk-agent-team/fleet-config
 */

import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { errorMessage, TeamError } from './error.ts'
import { resolveLanePolicy } from './lane-policy.ts'

/** Default cap on one repository fleet file. */
const DEFAULT_MAX_FLEET_CONFIG_BYTES = 65_536
/** Default providers that the G1 in-process Team surface can launch. */
const DEFAULT_FLEET_PROVIDERS: readonly string[] = ['spawn', 'fork']

const fleetMemberSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(200),
  prompt: z.string().min(1),
  context: z.enum(['fresh', 'fork']).optional(),
  provider: z.string().min(1).max(200).optional(),
  preset: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.string().min(1).optional(),
  readOnly: z.boolean().optional(),
  writeScopes: z.array(z.string().min(1)).optional(),
  maxTokens: z.number().int().positive().optional(),
}).strict()

const fleetConfigSchema = z.object({
  version: z.literal(1),
  fleet: z.object({
    label: z.string().min(1).max(200).optional(),
    members: z.array(fleetMemberSchema).min(1),
  }).strict(),
}).strict()

/** One repository-declared fleet member. */
export type RepoFleetMember = z.infer<typeof fleetMemberSchema>

/** One parsed repository fleet configuration. */
export type RepoFleetConfig = z.infer<typeof fleetConfigSchema>

/** One read snapshot of a repository fleet file. */
export interface RepoFleetSnapshot {
  /** Canonical repository root that owns the file. */
  readonly repositoryRoot: string
  /** Absolute fleet file path below `<root>/.gnk/fleet.json`. */
  readonly path: string
  /** SHA-256 of the exact raw file bytes. */
  readonly bytesHash: string
  /** Parsed, validated configuration. */
  readonly config: RepoFleetConfig
  /** Whether an unconsumed approval exists for these exact bytes. */
  readonly approved: boolean
}

/** Options for the repository fleet store. */
export interface RepoFleetConfigOptions {
  /** Harness home holding approval records. */
  readonly gnkHome: string
  /** Upper bound on one fleet file. */
  readonly maxBytes?: number
  /** Provider names this deployment may launch in-process. */
  readonly allowedProviders?: readonly string[]
}

/**
 * Size-capped, strict repository parsing with one-time approvals.
 */
export class RepoFleetConfigStore {
  private readonly gnkHome: string
  private readonly maxBytes: number
  private readonly allowedProviders: ReadonlySet<string>

  /**
   * @param options - harness home, byte cap, and in-process provider allowlist.
   */
  constructor(options: RepoFleetConfigOptions) {
    this.gnkHome = options.gnkHome
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_FLEET_CONFIG_BYTES
    this.allowedProviders = new Set(options.allowedProviders ?? DEFAULT_FLEET_PROVIDERS)
  }

  /**
   * Read and validate the fleet file without granting spend.
   * @param repositoryRoot - repository whose `.gnk/fleet.json` is read.
   * @param signal - cancellation for path and file reads.
   * @returns the parsed config, exact bytes hash, and current approval state.
   */
  async read(repositoryRoot: string, signal: AbortSignal): Promise<RepoFleetSnapshot> {
    signal.throwIfAborted()
    const root = await this.canonicalRoot(repositoryRoot)
    const path = join(root, '.gnk', 'fleet.json')
    const stats = await stat(path).catch((error: unknown) => {
      throw new TeamError(
        `repository fleet config ${path} is missing or unreadable: ${errorMessage(error)}`,
        'TEAM_FLEET_CONFIG_MISSING',
        { cause: error },
      )
    })
    if (!stats.isFile()) {
      throw new TeamError(`repository fleet config ${path} is not a file`, 'TEAM_FLEET_CONFIG_MISSING')
    }
    if (stats.size > this.maxBytes) {
      throw new TeamError(
        `repository fleet config ${path} is ${stats.size} bytes, above the ${this.maxBytes}-byte cap`,
        'TEAM_FLEET_CONFIG_TOO_LARGE',
      )
    }
    const raw = await readFile(path)
    signal.throwIfAborted()
    const bytesHash = createHash('sha256').update(raw).digest('hex')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch (error: unknown) {
      throw new TeamError(
        `repository fleet config ${path} is not valid JSON: ${errorMessage(error)}`,
        'TEAM_FLEET_CONFIG_INVALID',
        { cause: error },
      )
    }
    const config = this.validate(parsed, path)
    const approved = lstatSync(this.approvalPath(root, bytesHash), { throwIfNoEntry: false }) !== undefined
    return Object.freeze({ repositoryRoot: root, path, bytesHash, config, approved })
  }

  /**
   * Record one-time approval for the exact bytes currently on disk.
   * @param repositoryRoot - repository whose fleet config is approved.
   * @param signal - cancellation for the read and atomic write.
   * @returns the approved snapshot.
   */
  async approve(repositoryRoot: string, signal: AbortSignal): Promise<RepoFleetSnapshot> {
    const snapshot = await this.read(repositoryRoot, signal)
    signal.throwIfAborted()
    const path = this.approvalPath(snapshot.repositoryRoot, snapshot.bytesHash)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify({
      version: 1,
      repositoryRoot: snapshot.repositoryRoot,
      bytesHash: snapshot.bytesHash,
      approvedAt: Date.now(),
    }, undefined, 2)}\n`)
    await rename(temporary, path)
    return { ...snapshot, approved: true }
  }

  /**
   * Consume one approval and return the config it covers. Changed bytes fail
   * because their approval key does not exist; a second admission also fails
   * because the approval was removed.
   * @param repositoryRoot - repository whose fleet config is admitted.
   * @param signal - cancellation for the read and approval removal.
   * @returns the admitted configuration.
   */
  async admit(repositoryRoot: string, signal: AbortSignal): Promise<RepoFleetSnapshot> {
    const snapshot = await this.read(repositoryRoot, signal)
    if (!snapshot.approved) {
      throw new TeamError(
        `repository fleet config ${snapshot.path} has no approval for bytes ${snapshot.bytesHash}`,
        'TEAM_FLEET_CONFIG_UNAPPROVED',
      )
    }
    signal.throwIfAborted()
    await rm(this.approvalPath(snapshot.repositoryRoot, snapshot.bytesHash), { force: true })
    return snapshot
  }

  /** Validate one parsed value and enforce lane/provider policy before spend. */
  private validate(value: unknown, path: string): RepoFleetConfig {
    const parsed = fleetConfigSchema.safeParse(value)
    if (!parsed.success) {
      throw new TeamError(
        `repository fleet config ${path} has an invalid format: ${parsed.error.message}`,
        'TEAM_FLEET_CONFIG_INVALID',
      )
    }
    const names = new Set<string>()
    for (const member of parsed.data.fleet.members) {
      if (names.has(member.name)) {
        throw new TeamError(
          `repository fleet config ${path} repeats member "${member.name}"`,
          'TEAM_FLEET_CONFIG_INVALID',
        )
      }
      names.add(member.name)
      const provider = member.provider ?? 'spawn'
      if (!this.allowedProviders.has(provider)) {
        throw new TeamError(
          `repository fleet member "${member.name}" uses provider "${provider}", outside this deployment's in-process fleet providers`,
          'TEAM_FLEET_PROVIDER_UNSUPPORTED',
        )
      }
      try {
        resolveLanePolicy({
          ...member.readOnly === undefined ? {} : { readOnly: member.readOnly },
          ...member.writeScopes === undefined ? {} : { writeScopes: member.writeScopes },
        })
      } catch (error: unknown) {
        throw new TeamError(
          `repository fleet member "${member.name}" has an invalid lane policy: ${errorMessage(error)}`,
          'TEAM_FLEET_CONFIG_INVALID',
          { cause: error },
        )
      }
    }
    return parsed.data
  }

  /** Canonical absolute repository path used in every approval key. */
  private async canonicalRoot(repositoryRoot: string): Promise<string> {
    try {
      return await realpath(repositoryRoot)
    } catch (error: unknown) {
      throw new TeamError(
        `repository root ${repositoryRoot} is not readable: ${errorMessage(error)}`,
        'TEAM_FLEET_CONFIG_MISSING',
        { cause: error },
      )
    }
  }

  /** Approval record path keyed by canonical repository and exact bytes. */
  private approvalPath(repositoryRoot: string, bytesHash: string): string {
    const repositoryKey = createHash('sha256').update(repositoryRoot).digest('hex')
    return join(this.gnkHome, 'fleet-approvals', repositoryKey, `${bytesHash}.json`)
  }
}
