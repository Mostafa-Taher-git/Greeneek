import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { craftRoots, controlTokenPath, loadPilotCatalog } from '@greeneek/gnk-craft'
import type { CraftAppManifest, CraftHostOpenRequest } from '@greeneek/gnk-craft'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import { CraftLocalProvider } from '../src/provider.ts'
import type { CraftDiscoveryIo, CraftLocalConfig, CraftLocalIo } from '../src/types.ts'

const photocraft = loadPilotCatalog().require('photocraft')
const TOKEN = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const config: CraftLocalConfig = { requestTimeoutMs: 15_000, graceMs: 2_000, closeGraceMs: 2_000 }

/**
 * Scripted `serve` peer. It validates the argv it was spawned with, then
 * answers newline-framed JSON exactly as the installed CLI does: `methods` and
 * `engine.commands` succeed, every other method answers an unknown-method error.
 */
const SERVE_PEER = `import { appendFileSync, readFileSync } from 'node:fs'

const log = new URL('./requests.ndjson', import.meta.url)
const args = process.argv.slice(2)
const flag = name => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const reject = reason => {
  process.stderr.write('fake serve rejected: ' + reason + '\\n')
  process.exit(3)
}

if (args[0] !== 'serve') reject('expected the serve subcommand, got ' + String(args[0]))
if (flag('--control-token-file') !== process.env.FAKE_TOKEN_FILE) reject('control token file flag')
if (readFileSync(process.env.FAKE_TOKEN_FILE, 'utf8') !== process.env.FAKE_TOKEN) reject('control token file content')
if (flag('--automation-read-root') !== process.env.FAKE_READ_ROOT) reject('automation read root')
if (flag('--automation-write-root') !== process.env.FAKE_WRITE_ROOT) reject('automation write root')

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    if (line.trim() === '') continue
    appendFileSync(log, line + '\\n')
    const request = JSON.parse(line)
    const reply = request.method === 'methods'
      ? { id: request.id, ok: true, result: ['engine.commands', 'engine.execute', 'methods'] }
      : request.method === 'engine.commands'
        ? { id: request.id, ok: true, result: { commands: [{ id: 'convert', input: { type: 'object' } }] } }
        : { error: 'unknown method ' + request.method + ' (try methods)', id: request.id, ok: false }
    process.stdout.write(JSON.stringify(reply) + '\\n')
  }
})
process.stdin.on('end', () => { process.exit(0) })
`

const temporaryDirectories: string[] = []
/** Every child the spawn seam started, so a failed assertion cannot leak one. */
const liveChildren = new Set<ChildProcess>()

/** Create one throwaway workspace that the suite removes afterwards. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'craft-serve-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const child of liveChildren) child.kill()
  liveChildren.clear()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

/** One real process behind the provider's spawn seam, with its exit promise and stderr. */
interface RealProcess {
  readonly handle: SubprocessHandle
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  stderr(): string
}

/** Spawn one program with a spec's arguments, standing in for `ctx.subprocess`. */
function spawnReal(program: string, args: readonly string[], spec: SubprocessSpawnSpec, env: NodeJS.ProcessEnv): RealProcess {
  const child = spawn(program, [...args], {
    cwd: spec.cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  liveChildren.add(child)
  child.once('exit', () => { liveChildren.delete(child) })
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => { resolve({ exitCode, signal }) })
  })
  const handle = {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    terminate: () => { child.kill() },
    waitForExit: () => done.then(() => true),
    collected: { stdout: '', stderr: '' },
  } as unknown as SubprocessHandle
  return { handle, done, stderr: () => stderr }
}

describe('serve handshake over a real child process', () => {
  it('starts the manifest serve entry, speaks one serve request, and terminates it', async () => {
    const workspace = temporaryDirectory()
    const roots = craftRoots(workspace)
    const tokenPath = controlTokenPath(roots)
    const peer = join(workspace, 'serve-fake.mjs')
    writeFileSync(peer, SERVE_PEER, 'utf8')
    // Discovery resolves `<cliStem>-cli` beside the host Node; the spawn seam
    // then runs Node over the scripted peer with exactly the spec's arguments,
    // since a portable spec host cannot carry a real `<stem>-cli` executable.
    const installDir = dirname(process.execPath)
    const discoveredCli = join(installDir, `photocraft-cli${process.platform === 'win32' ? '.exe' : ''}`)
    const app: CraftAppManifest = {
      ...photocraft,
      launch: {
        ...photocraft.launch,
        headless: '{cli} serve-fake.mjs serve --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
      },
    }
    const discovery: CraftDiscoveryIo = {
      platform: process.platform,
      env: {},
      home: installDir,
      readText: () => undefined,
      isFile: path => path === discoveredCli,
      registryInstallDir: () => installDir,
    }
    const env: NodeJS.ProcessEnv = {
      FAKE_TOKEN_FILE: tokenPath,
      FAKE_TOKEN: TOKEN,
      FAKE_READ_ROOT: roots.read,
      FAKE_WRITE_ROOT: roots.write,
    }
    let spec: SubprocessSpawnSpec | undefined
    let real: RealProcess | undefined
    const io: CraftLocalIo = {
      discovery,
      ensureDir: (path) => { mkdirSync(path, { recursive: true }) },
      writeFile: (path, data) => { writeFileSync(path, data, { encoding: 'utf8', mode: 0o600 }) },
      spawn: (request) => {
        spec = request
        real = spawnReal(process.execPath, request.argv.slice(1), request, env)
        return real.handle
      },
    }
    const provider = new CraftLocalProvider(io, config)
    const signal = new AbortController().signal
    const request: CraftHostOpenRequest = { app, workspaceRoot: workspace, roots, controlToken: TOKEN, signal }

    const session = await provider.open(request)

    expect(spec?.argv).toEqual([
      discoveredCli,
      'serve-fake.mjs',
      'serve',
      '--automation-read-root',
      roots.read,
      '--automation-write-root',
      roots.write,
      '--control-token-file',
      tokenPath,
    ])
    expect(spec?.cwd).toBe(roots.read)
    expect(spec?.signal).toBe(signal)
    expect(spec?.stdio.stdin).toBe('pipe')
    expect(spec?.stdio.stdout).toBe('pipe')
    expect(readFileSync(tokenPath, 'utf8')).toBe(TOKEN)

    // The raw registry read matches the observed serve protocol. The separate
    // MCP catalog projection remains honestly unsupported by this serve peer.
    await expect(session.transport.readCommandRegistry()).resolves.toEqual({
      commands: [{ id: 'convert', input: { type: 'object' } }],
    })
    await expect(session.transport.listTools()).rejects.toThrow('unknown method command_list')
    const frames = readFileSync(join(workspace, 'requests.ndjson'), 'utf8').trim().split('\n')
    expect(frames.map(frame => JSON.parse(frame) as unknown)).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'engine.commands', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'command_list', params: {} },
    ])
    expect(real?.stderr()).toBe('')

    await session.close()
    await expect(real?.done).resolves.toBeDefined()
  })
})
