import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPilotCatalog } from '@greeneek/gnk-craft'
import type { CraftAppManifest } from '@greeneek/gnk-craft'
import { discoverApp, INSTALLED_FILE, portableFileName } from '../src/discovery.ts'
import { cliExecutableName } from '../src/platform.ts'
import type { CraftDiscoveryIo } from '../src/types.ts'

const catalog = loadPilotCatalog()
const photocraft = catalog.require('photocraft')
const pdfcraft = catalog.require('pdfcraft')

const LAUNCHER_ROOT = win32.join('C:\\Launcher', 'ArtCraft Launcher')

/** Discovery fake: only what a test names exists. */
function createIo(overrides: Partial<CraftDiscoveryIo> = {}): CraftDiscoveryIo {
  return {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Launcher' },
    home: 'C:\\Users\\u',
    readText: () => undefined,
    isFile: () => false,
    registryInstallDir: () => undefined,
    ...overrides,
  }
}

/** The absolute CLI path discovery expects for one install directory. */
function cliPath(app: CraftAppManifest, installDir: string): string {
  return win32.join(installDir, cliExecutableName(app.cliStem, 'win32'))
}

/** Serve one launcher manifest at the shared path. */
function withInstalled(record: unknown, extra: Partial<CraftDiscoveryIo> = {}): CraftDiscoveryIo {
  return createIo({
    readText: path => path === win32.join(LAUNCHER_ROOT, INSTALLED_FILE) ? JSON.stringify(record) : undefined,
    ...extra,
  })
}

describe('portableFileName', () => {
  it('derives a per-app marker name', () => {
    expect(portableFileName('pdfcraft')).toBe('pdfcraft.portable.txt')
  })
})

describe('discoverApp', () => {
  it('reports not-installed without probing when the app does not document this host', () => {
    let probed = false
    const io = createIo({
      platform: 'darwin',
      readText: () => { probed = true; return undefined },
      registryInstallDir: () => { probed = true; return undefined },
    })
    const discovery = discoverApp(photocraft, io)
    expect(discovery.state).toBe('not-installed')
    expect(discovery.detail).toContain('documents win32 support')
    expect(discovery.detail).toContain('darwin')
    expect(probed).toBe(false)
  })

  it('reports not-installed when no source names an install directory', () => {
    const discovery = discoverApp(photocraft, createIo())
    expect(discovery.state).toBe('not-installed')
    expect(discovery.detail).toContain('PhotoCraft')
  })

  it('reports ready with the absolute CLI and version from the launcher manifest', () => {
    const installDir = win32.join('C:\\Apps', 'PhotoCraft')
    const executable = cliPath(photocraft, installDir)
    const discovery = discoverApp(photocraft, withInstalled(
      { installDir, version: '1.2.0' },
      { isFile: path => path === executable },
    ))
    expect(discovery).toEqual({ state: 'ready', executable, version: '1.2.0' })
  })

  it('omits the version when the launcher did not report one', () => {
    const installDir = win32.join('C:\\Apps', 'PhotoCraft')
    const executable = cliPath(photocraft, installDir)
    const discovery = discoverApp(photocraft, withInstalled(
      { installDir },
      { isFile: path => path === executable },
    ))
    expect(discovery).toEqual({ state: 'ready', executable })
  })

  it('reports app-installed-cli-missing with the expected path when the CLI is absent', () => {
    const installDir = win32.join('C:\\Apps', 'PhotoCraft')
    const executable = cliPath(photocraft, installDir)
    const discovery = discoverApp(photocraft, withInstalled({ installDir }))
    expect(discovery.state).toBe('app-installed-cli-missing')
    expect(discovery.detail).toContain(executable)
  })

  it('reports unsupported-version when the installed version is below the manifest floor', () => {
    const installDir = win32.join('C:\\Apps', 'PhotoCraft')
    const executable = cliPath(photocraft, installDir)
    const discovery = discoverApp(photocraft, withInstalled(
      { installDir, version: '0.9.0' },
      { isFile: path => path === executable },
    ))
    expect(discovery.state).toBe('unsupported-version')
    expect(discovery.executable).toBe(executable)
    expect(discovery.version).toBe('0.9.0')
    expect(discovery.detail).toContain(`older than the required ${photocraft.minVersion}`)
  })

  it('skips a stale record whose CLI is missing and uses the registry install', () => {
    const stale = win32.join('C:\\Old', 'PhotoCraft')
    const working = win32.join('C:\\Apps', 'PhotoCraft')
    const executable = cliPath(photocraft, working)
    const discovery = discoverApp(photocraft, createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, INSTALLED_FILE)
        ? JSON.stringify({ installDir: stale, version: '1.2.0' })
        : undefined,
      isFile: path => path === executable,
      registryInstallDir: () => working,
    }))
    expect(discovery).toEqual({ state: 'ready', executable })
  })

  it('reads a portable marker named for the legacy alias', () => {
    const installDir = win32.join('C:\\Apps', 'PrintCraft')
    const executable = cliPath(pdfcraft, installDir)
    const discovery = discoverApp(pdfcraft, createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, portableFileName('printcraft'))
        ? `  ${installDir}  `
        : undefined,
      isFile: path => path === executable,
    }))
    expect(discovery).toEqual({ state: 'ready', executable })
  })

  it('deduplicates the same install directory reported twice', () => {
    const installDir = win32.join('C:\\Apps', 'PhotoCraft')
    const executable = cliPath(photocraft, installDir)
    const io = withInstalled(
      { installDir, version: '1.2.0' },
      {
        isFile: path => path === executable,
        registryInstallDir: () => installDir,
      },
    )
    expect(discoverApp(photocraft, io).state).toBe('ready')
  })

  it('ignores blank portable markers and blank registry values', () => {
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, portableFileName('photocraft')) ? '   ' : undefined,
      registryInstallDir: () => '   ',
    })
    expect(discoverApp(photocraft, io).state).toBe('not-installed')
  })

  it('keeps the first expected CLI when every candidate is missing its CLI', () => {
    const first = win32.join('C:\\A', 'PhotoCraft')
    const second = win32.join('C:\\B', 'PhotoCraft')
    const discovery = discoverApp(photocraft, createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, portableFileName('photocraft'))
        ? `\n${second}\n`
        : undefined,
      registryInstallDir: () => first,
    }))
    expect(discovery.state).toBe('app-installed-cli-missing')
    expect(discovery.detail).toContain(cliPath(photocraft, second))
  })

  it('ignores a malformed launcher manifest', () => {
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, INSTALLED_FILE) ? '{not json' : undefined,
    })
    expect(discoverApp(photocraft, io).state).toBe('not-installed')
  })
})
