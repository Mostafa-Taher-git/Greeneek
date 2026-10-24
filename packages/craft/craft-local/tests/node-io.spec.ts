import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPilotCatalog } from '@greeneek/gnk-craft'
import {
  createNodeDiscoveryIo,
  createNodeLocalIo,
  defaultExec,
  isRegularFile,
  queryRegistryInstallDir,
  readTextFile,
} from '../src/node-io.ts'

const photocraft = loadPilotCatalog().require('photocraft')
const temporaryDirectories: string[] = []

/** Create one throwaway directory that the suite removes afterwards. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'craft-local-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('readTextFile', () => {
  it('reads an existing UTF-8 file', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'installed.json')
    writeFileSync(path, '{"installDir":"/apps"}', 'utf8')
    expect(readTextFile(path)).toBe('{"installDir":"/apps"}')
  })

  it('returns undefined for a missing path', () => {
    expect(readTextFile(join(tmpdir(), 'craft-local-does-not-exist.json'))).toBeUndefined()
  })
})

describe('isRegularFile', () => {
  it('accepts a regular file', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'cli')
    writeFileSync(path, '')
    expect(isRegularFile(path)).toBe(true)
  })

  it('rejects a directory and a missing path', () => {
    const directory = temporaryDirectory()
    const subdirectory = join(directory, 'nested')
    mkdirSync(subdirectory)
    expect(isRegularFile(subdirectory)).toBe(false)
    expect(isRegularFile(join(directory, 'missing'))).toBe(false)
  })
})

describe('queryRegistryInstallDir', () => {
  it('queries HKLM Software under the display name', () => {
    const exec = vi.fn(() => '    InstallDir    REG_SZ    C:\\Apps')
    expect(queryRegistryInstallDir(photocraft, exec))
      .toBe('    InstallDir    REG_SZ    C:\\Apps')
    expect(exec).toHaveBeenCalledWith('reg.exe', ['query', 'HKLM\\Software\\PhotoCraft', '/v', 'InstallDir'])
  })
})

describe('createNodeDiscoveryIo', () => {
  it('uses the injected platform, environment, and home', () => {
    const io = createNodeDiscoveryIo({ platform: 'linux', env: { XDG_DATA_HOME: '/data' }, home: '/home/u' })
    expect(io.platform).toBe('linux')
    expect(io.env).toEqual({ XDG_DATA_HOME: '/data' })
    expect(io.home).toBe('/home/u')
  })

  it('returns no registry value on a non-Windows platform', () => {
    const exec = vi.fn(() => '    InstallDir    REG_SZ    /apps')
    const io = createNodeDiscoveryIo({ platform: 'linux', exec })
    expect(io.registryInstallDir(photocraft)).toBeUndefined()
    expect(exec).not.toHaveBeenCalled()
  })

  it('parses the Windows registry value', () => {
    const io = createNodeDiscoveryIo({
      platform: 'win32',
      env: {},
      home: 'C:\\Users\\u',
      exec: () => '    InstallDir    REG_EXPAND_SZ    C:\\Apps\\PhotoCraft',
    })
    expect(io.registryInstallDir(photocraft)).toBe('C:\\Apps\\PhotoCraft')
  })

  it('contains a failed registry query', () => {
    const io = createNodeDiscoveryIo({
      platform: 'win32',
      exec: () => { throw new Error('missing hive') },
    })
    expect(io.registryInstallDir(photocraft)).toBeUndefined()
  })

  it('defaults to the host environment, home, and command runner', () => {
    const io = createNodeDiscoveryIo({ platform: 'linux' })
    expect(io.env).toBe(process.env)
    expect(io.home.length).toBeGreaterThan(0)
    expect(io).toMatchObject({ readText: readTextFile, isFile: isRegularFile })
  })
})

describe('createNodeLocalIo', () => {
  it('creates directories and writes token files', () => {
    const directory = temporaryDirectory()
    const target = join(directory, 'out')
    const io = createNodeLocalIo(() => { throw new Error('unused') }, {
      platform: 'linux',
      env: {},
      home: directory,
    })

    io.ensureDir(target)
    io.writeFile(join(target, '.craft-control-token'), 'secret')

    expect(io.discovery.platform).toBe('linux')
    expect(isRegularFile(join(target, '.craft-control-token'))).toBe(true)
    expect(readTextFile(join(target, '.craft-control-token'))).toBe('secret')
  })

  it('delegates spawn and forwards an optional warning sink', () => {
    const handle = { pid: 1 }
    const spawn = vi.fn(() => handle)
    const warn = vi.fn()
    const io = createNodeLocalIo(spawn as never, { platform: 'linux', env: {}, home: '/home/u', warn })

    expect(io.spawn({} as never)).toBe(handle)
    io.warn?.('diagnostic')

    expect(spawn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('diagnostic')
  })

  it('omits the warning sink when none was supplied', () => {
    const io = createNodeLocalIo((() => ({ pid: 1 })) as never, { platform: 'linux', env: {}, home: '/home/u' })
    expect(io).not.toHaveProperty('warn')
  })
})

describe('defaultExec', () => {
  it('returns one command’s stdout', () => {
    const output = defaultExec(process.execPath, ['-e', 'process.stdout.write("ok")'])
    expect(output).toBe('ok')
  })
})
