/**
 * Local Craft host provider: discovery-gated, token-gated headless spawns over
 * `ctx.subprocess`, plus the desktop-only connected launch.
 *
 * Security posture: a session refuses to spawn unless discovery proves an
 * absolute CLI and the caller supplied a per-launch control token; the token is
 * written under the confined job root and handed to the app by file path only.
 * The headless argument vector comes from the manifest's `launch.headless`
 * template, so which entry point starts the app is manifest data rather than a
 * second copy in this provider.
 * @module @greeneek/gnk-craft-local/provider
 */

import { CraftError, controlTokenPath } from '@greeneek/gnk-craft'
import type {
  CraftAppManifest,
  CraftDiscovery,
  CraftHostOpenRequest,
  CraftHostProvider,
  CraftHostSession,
  CraftRoots,
} from '@greeneek/gnk-craft'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import { discoverApp } from './discovery.ts'
import { expandHeadlessLaunch } from './launch.ts'
import { guiExecutableName, platformPath } from './platform.ts'
import { JsonRpcCraftTransport } from './transport.ts'
import type { CraftLocalConfig, CraftLocalIo } from './types.ts'

/** Stderr diagnostic tail retained for one headless session. */
const STDERR_TAIL_BYTES = 16 * 1024

/**
 * Require a ready discovery result.
 * @param app - validated manifest.
 * @param discovery - measured installation.
 * @returns the absolute CLI path.
 */
export function requireExecutable(app: CraftAppManifest, discovery: CraftDiscovery): string {
  if (discovery.state !== 'ready' || discovery.executable === undefined) {
    throw new CraftError(
      `${app.displayName} is not ready: ${discovery.detail ?? discovery.state}`,
      'CRAFT_APP_NOT_READY',
    )
  }
  return discovery.executable
}

/**
 * Default local host provider.
 */
export class CraftLocalProvider implements CraftHostProvider {
  /** Provider id used by `craft.provider` pinning. */
  readonly id = 'craft-local'

  private readonly io: CraftLocalIo
  private readonly config: CraftLocalConfig

  /**
   * @param io - discovery, filesystem, and spawn boundary.
   * @param config - request deadline and termination grace.
   */
  constructor(io: CraftLocalIo, config: CraftLocalConfig) {
    this.io = io
    this.config = config
  }

  /** {@inheritDoc CraftHostProvider.discover} */
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async discover(app: CraftAppManifest, options: { readonly signal: AbortSignal }): Promise<CraftDiscovery> {
    options.signal.throwIfAborted()
    return discoverApp(app, this.io.discovery)
  }

  /** {@inheritDoc CraftHostProvider.open} */
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async open(request: CraftHostOpenRequest): Promise<CraftHostSession> {
    request.signal.throwIfAborted()
    if (request.controlToken.trim() === '') {
      throw new CraftError(
        `a ${request.app.displayName} session requires a per-launch control token`,
        'CRAFT_TOKEN_REQUIRED',
      )
    }
    const executable = this.requireExecutable(request.app)
    const tokenPath = controlTokenPath(request.roots)
    // A refused template must fail before the token file exists, so the job
    // root never keeps a secret for a session that cannot start.
    const argv = expandHeadlessLaunch(request.app.launch.headless, {
      app: request.app.displayName,
      cli: executable,
      readRoot: request.roots.read,
      writeRoot: request.roots.write,
      controlTokenFile: tokenPath,
    })
    this.io.ensureDir(request.roots.write)
    this.io.writeFile(tokenPath, request.controlToken)
    let handle: SubprocessHandle
    try {
      handle = this.io.spawn(this.headlessSpec(request, argv))
    } catch (error: unknown) {
      throw new CraftError(
        `${request.app.displayName} headless CLI could not start`,
        'CRAFT_APP_NOT_READY',
        { cause: error },
      )
    }
    const transport = new JsonRpcCraftTransport(
      {
        stdin: handle.stdin,
        stdout: handle.stdout,
        done: handle.done,
        terminate: () => { handle.terminate() },
      },
      {
        listMethod: request.app.headless.listMethod,
        registryMethod: request.app.headless.registryMethod,
        requestTimeoutMs: this.config.requestTimeoutMs,
        closeGraceMs: this.config.closeGraceMs,
        warn: message => this.io.warn?.(message),
      },
    )
    return { transport, close: () => transport.close() }
  }

  /** {@inheritDoc CraftHostProvider.launchConnected} */
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async launchConnected(request: {
    readonly app: CraftAppManifest
    readonly workspaceRoot: string
    readonly roots: CraftRoots
  }): Promise<void> {
    const executable = this.requireExecutable(request.app)
    const path = platformPath(this.io.discovery.platform)
    const gui = path.join(path.dirname(executable), guiExecutableName(request.app.cliStem, this.io.discovery.platform))
    const handle = this.io.spawn({
      argv: [
        gui,
        '--control',
        request.roots.write,
        '--automation-read-root',
        request.roots.read,
        '--automation-write-root',
        request.roots.write,
      ],
      cwd: request.workspaceRoot,
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
      graceMs: this.config.graceMs,
    })
    // A detached GUI outlives the invocation; only a spawn-level failure is
    // actionable here, and it must not surface as an unhandled rejection.
    void handle.done.catch((error: unknown) => {
      this.io.warn?.(`craft-local: connected launch ended early: ${String(error)}`)
    })
  }

  /** Resolve the absolute CLI or fail with an actionable state detail. */
  private requireExecutable(app: CraftAppManifest): string {
    return requireExecutable(app, discoverApp(app, this.io.discovery))
  }

  /** Build the fully specified headless spawn around the expanded argv. */
  private headlessSpec(request: CraftHostOpenRequest, argv: readonly string[]): SubprocessSpawnSpec {
    return {
      argv,
      cwd: request.roots.read,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: STDERR_TAIL_BYTES },
      },
      graceMs: this.config.graceMs,
      signal: request.signal,
    }
  }
}
