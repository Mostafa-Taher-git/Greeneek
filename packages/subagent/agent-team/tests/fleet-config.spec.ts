import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamError } from '../src/error.ts'
import { RepoFleetConfigStore } from '../src/fleet-config.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One isolated temp directory removed after the test. */
function tempRoot(prefix = 'gnk-fleet-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** One repository root with the given fleet document. */
function repository(document: string): string {
  const root = tempRoot('gnk-fleet-repo-')
  mkdirSync(join(root, '.gnk'))
  writeFileSync(join(root, '.gnk', 'fleet.json'), document)
  return root
}

/** One valid fleet document with two members. */
function validDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    fleet: {
      label: 'review fleet',
      members: [
        {
          name: 'reviewer',
          description: 'review changes',
          prompt: 'Review the pending changes.',
          preset: 'standard',
          model: 'mock',
          reasoningEffort: 'high',
          readOnly: true,
          maxTokens: 4_000,
        },
        {
          name: 'docs',
          description: 'write docs',
          prompt: 'Update the docs.',
          context: 'fresh',
          provider: 'spawn',
          writeScopes: ['docs'],
        },
      ],
    },
    ...overrides,
  })
}

/** Await one rejection and keep its typed Team error. */
async function rejection(operation: Promise<unknown>): Promise<TeamError> {
  try {
    await operation
  } catch (error) {
    if (error instanceof TeamError) return error
    throw error
  }
  throw new Error('expected the operation to reject')
}

describe('repository fleet config', () => {
  it('reads a valid document with its exact bytes hash and approval state', async () => {
    const repo = repository(validDocument())
    const store = new RepoFleetConfigStore({ gnkHome: tempRoot() })

    const snapshot = await store.read(repo, SIGNAL)

    expect(snapshot.repositoryRoot).toContain('gnk-fleet-repo-')
    expect(snapshot.path).toBe(join(snapshot.repositoryRoot, '.gnk', 'fleet.json'))
    expect(snapshot.bytesHash).toHaveLength(64)
    expect(snapshot.approved).toBe(false)
    expect(snapshot.config.fleet.members.map(member => member.name)).toEqual(['reviewer', 'docs'])
  })

  it('requires a fresh approval for changed bytes and consumes it once', async () => {
    const repo = repository(validDocument())
    const store = new RepoFleetConfigStore({ gnkHome: tempRoot() })

    const approved = await store.approve(repo, SIGNAL)
    expect(approved.approved).toBe(true)
    expect((await store.read(repo, SIGNAL)).approved).toBe(true)

    const admitted = await store.admit(repo, SIGNAL)
    expect(admitted.bytesHash).toBe(approved.bytesHash)
    expect((await rejection(store.admit(repo, SIGNAL))).code).toBe('TEAM_FLEET_CONFIG_UNAPPROVED')

    writeFileSync(join(repo, '.gnk', 'fleet.json'), validDocument().replace('review fleet', 'changed fleet'))
    expect((await rejection(store.admit(repo, SIGNAL))).code).toBe('TEAM_FLEET_CONFIG_UNAPPROVED')
    expect((await store.approve(repo, SIGNAL)).approved).toBe(true)
    expect((await store.admit(repo, SIGNAL)).config.fleet.label).toBe('changed fleet')
  })

  it('writes approvals atomically below the harness home', async () => {
    const repo = repository(validDocument())
    const gnkHome = tempRoot('gnk-fleet-home-')
    const store = new RepoFleetConfigStore({ gnkHome })

    const approved = await store.approve(repo, SIGNAL)
    const approvals = join(gnkHome, 'fleet-approvals')
    const repositoryDirectories = readdirRecursive(approvals)
    expect(repositoryDirectories.some(path => path.endsWith(`${approved.bytesHash}.json`))).toBe(true)
    const record = JSON.parse(readFileSync(repositoryDirectories.find(path => path.endsWith(`${approved.bytesHash}.json`))!, 'utf8')) as Record<string, unknown>
    expect(record).toMatchObject({
      version: 1,
      repositoryRoot: approved.repositoryRoot,
      bytesHash: approved.bytesHash,
    })
    expect(typeof record.approvedAt).toBe('number')
  }, 10_000)

  it('rejects an oversized, malformed, duplicate, or unsupported document', async () => {
    const gnkHome = tempRoot()
    const store = new RepoFleetConfigStore({ gnkHome, maxBytes: 512 })

    expect((await rejection(new RepoFleetConfigStore({ gnkHome }).read(repository('{'), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_INVALID')
    expect((await rejection(new RepoFleetConfigStore({ gnkHome }).read(repository(JSON.stringify({ version: 2 })), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_INVALID')
    expect((await rejection(new RepoFleetConfigStore({ gnkHome }).read(repository(validDocument({ version: 2 })), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_INVALID')

    const duplicate = validDocument({
      fleet: {
        members: [
          { name: 'same', description: 'a', prompt: 'a' },
          { name: 'same', description: 'b', prompt: 'b' },
        ],
      },
    })
    expect((await rejection(new RepoFleetConfigStore({ gnkHome }).read(repository(duplicate), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_INVALID')

    const unsupported = validDocument({
      fleet: { members: [{ name: 'remote', description: 'a', prompt: 'a', provider: 'claude-code' }] },
    })
    expect((await rejection(new RepoFleetConfigStore({ gnkHome }).read(repository(unsupported), SIGNAL))).code)
      .toBe('TEAM_FLEET_PROVIDER_UNSUPPORTED')

    const contradictory = validDocument({
      fleet: { members: [{ name: 'both', description: 'a', prompt: 'a', readOnly: true, writeScopes: ['src'] }] },
    })
    expect((await rejection(new RepoFleetConfigStore({ gnkHome }).read(repository(contradictory), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_INVALID')

    const large = repository(validDocument({ padding: 'x'.repeat(1_024) }))
    expect((await rejection(store.read(large, SIGNAL))).code).toBe('TEAM_FLEET_CONFIG_TOO_LARGE')
  })

  it('reports a missing repository or fleet file and refuses a directory', async () => {
    const store = new RepoFleetConfigStore({ gnkHome: tempRoot() })
    expect((await rejection(store.read(join(tempRoot(), 'absent'), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_MISSING')
    expect((await rejection(store.read(tempRoot(), SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_MISSING')
    const directory = tempRoot('gnk-fleet-dir-')
    mkdirSync(join(directory, '.gnk', 'fleet.json'), { recursive: true })
    expect((await rejection(store.read(directory, SIGNAL))).code)
      .toBe('TEAM_FLEET_CONFIG_MISSING')
  })
})

/** Every file below one directory, recursively. */
function readdirRecursive(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...readdirRecursive(path))
    else found.push(path)
  }
  return found
}
