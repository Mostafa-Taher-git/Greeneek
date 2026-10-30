import { PassThrough } from 'node:stream'
import { resolve, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftError, craftRoots, controlTokenPath, loadPilotCatalog } from '@greeneek/gnk-craft'
import type { CraftAppManifest, CraftHostOpenRequest, CraftRoots } from '@greeneek/gnk-craft'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import { CraftLocalProvider, requireExecutable } from '../src/provider.ts'
import { cliExecutableName, guiExecutableName } from '../src/platform.ts'
import { INSTALLED_FILE } from '../src/discovery.ts'
import type { CraftDiscoveryIo, CraftLocalConfig, CraftLocalIo } from '../src/types.ts'

const catalog = loadPilotCatalog()
const photocraft = catalog.require('photocraft')

const WORKSPACE = resolve('craft-workspace')
const ROOTS: CraftRoots = craftRoots(WORKSPACE)
const TOKEN = 'token-123'
const INSTALL_DIR = resolve('craft-install')
const LAUNCHER_ROOT = win32.join('C:\\Launcher', 'ArtCraft Launcher')
const CLI = win32.join(INSTALL_DIR, cliExecutableName(photocraft.cliStem, 'win32'))

/** A serve-protocol variant of the pilot manifest for token and argv tests. */
const serveApp: CraftAppManifest = {
  ...photocraft,
  transport: 'serve',
  headless: { ...photocraft.headless, controlToken: 'required', registryMethod: 'engine.commands' },
  launch: {
    ...photocraft.launch,
    headless: '{cli} serve --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
  },
}

const config: CraftLocalConfig = { requestTimeoutMs: 100, graceMs: 20, closeGraceMs: 5 }

interface FakeHandle {
  readonly handle: SubprocessHandle
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly terminate: ReturnType<typeof vi.fn>
  settle(value?: { exitCode: number | null; signal: NodeJS.Signals | null }): void
  fail(error: Error): void
}

/** Fake managed process whose terminate settles it unless told otherwise. */
function createHandle(options: { readonly settleOnTerminate?: boolean } = {}): FakeHandle {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let settle!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  let reject!: (error: Error) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveDone, rejectDone) => {
    settle = resolveDone
    reject = rejectDone
  })
  const terminate = vi.fn(() => {
    if (options.settleOnTerminate !== false) settle({ exitCode: null, signal: 'SIGTERM' })
  })
  const handle = {
    pid: 1234,
    stdin,
    stdout,
    stderr,
    done,
    terminate: () => { terminate() },
    waitForExit: () => Promise.resolve(true),
    collected: { stdout: '', stderr: '' },
  } as unknown as SubprocessHandle
  return {
    handle,
    stdin,
    stdout,
    terminate,
    settle: (value = { exitCode: 0, signal: null }) =>{  settle(value) },
    fail: reject,
  }
}

/** Discovery fake for one installed app. */
function installedIo(version = '1.2.0'): CraftDiscoveryIo {
  return {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Launcher' },
    home: 'C:\\Users\\u',
    readText: path => path === win32.join(LAUNCHER_ROOT, INSTALLED_FILE)
      ? JSON.stringify({ apps: { photocraft: { installDir: INSTALL_DIR, version } } })
      : undefined,
    isFile: path => path === CLI,
    registryInstallDir: () => undefined,
  }
}

/** Discovery fake with no installation at all. */
function missingIo(): CraftDiscoveryIo {
  return {
    platform: 'win32',
    env: {},
    home: 'C:\\Users\\u',
    readText: () => undefined,
    isFile: () => false,
    registryInstallDir: () => undefined,
  }
}

interface LocalIoFixture {
  readonly io: CraftLocalIo
  readonly ensureDir: ReturnType<typeof vi.fn>
  readonly writeFile: ReturnType<typeof vi.fn>
  readonly spawn: ReturnType<typeof vi.fn>
  readonly warn: ReturnType<typeof vi.fn>
}

/** Local IO fake recording every boundary call. */
function localIo(
  discovery: CraftDiscoveryIo,
  spawnResult: () => FakeHandle = () => createHandle(),
  options: { readonly warn?: boolean; readonly throwOnSpawn?: Error } = {},
): LocalIoFixture {
  const ensureDir = vi.fn()
  const writeFile = vi.fn()
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => {
    if (options.throwOnSpawn !== undefined) throw options.throwOnSpawn
    return spawnResult().handle
  })
  const warn = vi.fn()
  return {
    io: {
      discovery,
      ensureDir,
      writeFile,
      spawn,
      ...options.warn === false ? {} : { warn },
    },
    ensureDir,
    writeFile,
    spawn,
    warn,
  }
}

/** The one accepted open request for the installed PhotoCraft fake. */
function openRequest(signal = new AbortController().signal): CraftHostOpenRequest {
  return { app: serveApp, workspaceRoot: WORKSPACE, roots: ROOTS, controlToken: TOKEN, signal }
}

/** The pilot manifest with one substituted headless template. */
function manifestWithTemplate(headless: string): CraftAppManifest {
  return { ...serveApp, launch: { ...serveApp.launch, headless } }
}

describe('requireExecutable', () => {
  it('returns the measured executable', () => {
    expect(requireExecutable(photocraft, { state: 'ready', executable: CLI })).toBe(CLI)
  })

  it('fails with the state name when discovery supplied no detail', () => {
    expect(() => requireExecutable(photocraft, { state: 'not-installed' }))
      .toThrow(/not ready: not-installed/)
  })

  it('fails with the actionable detail when discovery supplied one', () => {
    expect(() => requireExecutable(photocraft, { state: 'app-installed-cli-missing', detail: 'CLI missing' }))
      .toThrow(/not ready: CLI missing/)
  })

  it.each(['unsupported-version', 'drifted', 'failed'] as const)('rejects %s even when an executable remains', (state) => {
    expect(() => requireExecutable(photocraft, { state, executable: CLI }))
      .toThrow(new RegExp(`not ready: ${state}`))
  })
})

describe('CraftLocalProvider', () => {
  it('publishes the stable provider id', () => {
    const fixture = localIo(installedIo())
    expect(new CraftLocalProvider(fixture.io, config).id).toBe('craft-local')
  })

  it('delegates discovery and honors an aborted signal', async () => {
    const provider = new CraftLocalProvider(localIo(installedIo()).io, config)
    await expect(provider.discover(photocraft, { signal: new AbortController().signal }))
      .resolves.toEqual({ state: 'ready', executable: CLI, version: '1.2.0' })

    const controller = new AbortController()
    controller.abort()
    await expect(provider.discover(photocraft, { signal: controller.signal })).rejects.toThrow()
  })

  it('refuses a session without a control token before touching the filesystem', async () => {
    const fixture = localIo(installedIo())
    const provider = new CraftLocalProvider(fixture.io, config)

    await expect(provider.open({ ...openRequest(), controlToken: '   ' }))
      .rejects.toMatchObject({ code: 'CRAFT_TOKEN_REQUIRED' })
    expect(fixture.ensureDir).not.toHaveBeenCalled()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('refuses a session when discovery does not find a ready CLI', async () => {
    const fixture = localIo(missingIo())
    const provider = new CraftLocalProvider(fixture.io, config)

    await expect(provider.open(openRequest())).rejects.toMatchObject({ code: 'CRAFT_APP_NOT_READY' })
    expect(fixture.writeFile).not.toHaveBeenCalled()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('refuses headless and connected launches for an unsupported version', async () => {
    const fixture = localIo(installedIo('0.9.0'))
    const provider = new CraftLocalProvider(fixture.io, config)

    await expect(provider.open(openRequest())).rejects.toMatchObject({ code: 'CRAFT_APP_NOT_READY' })
    await expect(provider.launchConnected({ app: photocraft, workspaceRoot: WORKSPACE, roots: ROOTS }))
      .rejects.toMatchObject({ code: 'CRAFT_APP_NOT_READY' })
    expect(fixture.writeFile).not.toHaveBeenCalled()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('honors an aborted open signal before discovery', async () => {
    const fixture = localIo(installedIo())
    const provider = new CraftLocalProvider(fixture.io, config)
    const controller = new AbortController()
    controller.abort()

    await expect(provider.open(openRequest(controller.signal))).rejects.toThrow()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('writes the token, spawns the headless CLI, and publishes the transport', async () => {
    const handle = createHandle()
    const fixture = localIo(installedIo(), () => handle, { warn: false })
    const provider = new CraftLocalProvider(fixture.io, config)
    const signal = new AbortController().signal

    const session = await provider.open(openRequest(signal))

    const tokenPath = controlTokenPath(ROOTS)
    expect(fixture.ensureDir).toHaveBeenCalledWith(ROOTS.write)
    expect(fixture.writeFile).toHaveBeenCalledWith(tokenPath, TOKEN)
    const spec = fixture.spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual([
      CLI,
      'serve',
      '--automation-read-root',
      ROOTS.read,
      '--automation-write-root',
      ROOTS.write,
      '--control-token-file',
      tokenPath,
    ])
    expect(spec.cwd).toBe(ROOTS.read)
    expect(spec.graceMs).toBe(config.graceMs)
    expect(spec.signal).toBe(signal)
    expect(spec.stdio.stdin).toBe('pipe')
    expect(spec.stdio.stdout).toBe('pipe')

    // The session projects a real JSON-RPC round trip over the piped process.
    handle.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() === '') continue
        const request = JSON.parse(line) as { id: number }
        handle.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [] } })}\n`)
      }
    })
    await expect(session.transport.listTools()).resolves.toEqual([])
    await session.close()
    expect(handle.terminate).toHaveBeenCalled()
  })

  it('opens an MCP session without writing a control token', async () => {
    const handle = createHandle()
    const fixture = localIo(installedIo(), () => handle, { warn: false })
    const provider = new CraftLocalProvider(fixture.io, config)
    const app: CraftAppManifest = {
      ...photocraft,
      transport: 'mcp',
      headless: { ...photocraft.headless, controlToken: 'unused' },
      launch: {
        ...photocraft.launch,
        headless: '{cli} mcp --automation-read-root {readRoot} --automation-write-root {writeRoot}',
      },
    }

    const session = await provider.open({ ...openRequest(), app })

    expect(fixture.ensureDir).toHaveBeenCalledWith(ROOTS.write)
    expect(fixture.writeFile).not.toHaveBeenCalled()
    const spec = fixture.spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual([
      CLI,
      'mcp',
      '--automation-read-root',
      ROOTS.read,
      '--automation-write-root',
      ROOTS.write,
    ])
    await session.close()
  })

  it('spawns the argument vector the manifest template expands to', async () => {
    const handle = createHandle()
    const fixture = localIo(installedIo(), () => handle, { warn: false })
    const provider = new CraftLocalProvider(fixture.io, config)
    const app = manifestWithTemplate(
      '{cli} serve --control-token-file {controlTokenFile} --automation-write-root {writeRoot} --automation-read-root {readRoot}',
    )

    const session = await provider.open({ ...openRequest(), app })

    const spec = fixture.spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual([
      CLI,
      'serve',
      '--control-token-file',
      controlTokenPath(ROOTS),
      '--automation-write-root',
      ROOTS.write,
      '--automation-read-root',
      ROOTS.read,
    ])
    await session.close()
  })

  it('refuses a template that does not start the serve entry before spawning', async () => {
    const fixture = localIo(installedIo(), () => createHandle())
    const provider = new CraftLocalProvider(fixture.io, config)

    const error = await provider.open({ ...openRequest(), app: manifestWithTemplate('photocraft-cli --headless') })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CraftError)
    expect((error as CraftError).code).toBe('CRAFT_MANIFEST_INVALID')
    expect((error as CraftError).message).toContain('must open with {cli}')
    expect(fixture.writeFile).not.toHaveBeenCalled()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('contains a spawn-level failure as app-not-ready', async () => {
    const cause = new Error('spawn failed')
    const fixture = localIo(installedIo(), undefined, { throwOnSpawn: cause })
    const provider = new CraftLocalProvider(fixture.io, config)

    const error = await provider.open(openRequest()).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(CraftError)
    expect((error as CraftError).code).toBe('CRAFT_APP_NOT_READY')
    expect((error as CraftError).cause).toBe(cause)
  })

  it('forwards malformed app output to the diagnostic sink when one exists', async () => {
    const handle = createHandle()
    const fixture = localIo(installedIo(), () => handle, { warn: true })
    const provider = new CraftLocalProvider(fixture.io, config)

    const session = await provider.open(openRequest())
    handle.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() === '') continue
        const request = JSON.parse(line) as { id: number }
        handle.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [] } })}\n`)
      }
    })
    const pending = session.transport.listTools()
    handle.stdout.write('plain log line\n')

    await expect(pending).resolves.toEqual([])
    expect(fixture.warn).toHaveBeenCalledWith(expect.stringContaining('non-JSON app output'))
    await session.close()
  })

  it('launches the connected GUI in the job root and contains a later failure', async () => {
    const handle = createHandle({ settleOnTerminate: false })
    const fixture = localIo(installedIo(), () => handle)
    const provider = new CraftLocalProvider(fixture.io, config)

    await provider.launchConnected({ app: photocraft, workspaceRoot: WORKSPACE, roots: ROOTS })

    const spec = fixture.spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual([
      win32.join(INSTALL_DIR, guiExecutableName(photocraft.cliStem, 'win32')),
      '--control',
      ROOTS.write,
      '--automation-read-root',
      ROOTS.read,
      '--automation-write-root',
      ROOTS.write,
    ])
    expect(spec.cwd).toBe(WORKSPACE)
    expect(spec.stdio).toEqual({ stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })

    handle.fail(new Error('gui exited'))
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.warn).toHaveBeenCalledWith(expect.stringContaining('connected launch ended early'))
  })

  it('refuses a connected launch when the app is not ready', async () => {
    const fixture = localIo(missingIo())
    const provider = new CraftLocalProvider(fixture.io, config)

    await expect(provider.launchConnected({ app: photocraft, workspaceRoot: WORKSPACE, roots: ROOTS }))
      .rejects.toMatchObject({ code: 'CRAFT_APP_NOT_READY' })
    expect(fixture.spawn).not.toHaveBeenCalled()
  })
})
