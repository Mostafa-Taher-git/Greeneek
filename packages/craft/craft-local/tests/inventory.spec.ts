import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listInstalledApps } from '../src/discovery.ts'
import { CraftLocalProvider } from '../src/provider.ts'
import type { CraftLocalIo } from '../src/types.ts'
import {
  normalizeArtCraftId,
  parseDesktopFile,
  parseInstalledJsonAll,
  parseLauncherAppRonAll,
  parseRegistryInstallDirs,
} from '../src/platform.ts'
import type { CraftDiscoveryIo } from '../src/types.ts'

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

describe('normalizeArtCraftId', () => {
  it('normalizes launcher keys into kebab ids', () => {
    expect(normalizeArtCraftId('PhotoCraft')).toBe('photocraft')
    expect(normalizeArtCraftId('Office Craft')).toBe('office-craft')
    expect(normalizeArtCraftId('  PDF_Craft  ')).toBe('pdf-craft')
  })

  it('rejects keys with no usable id', () => {
    expect(normalizeArtCraftId('')).toBeUndefined()
    expect(normalizeArtCraftId('x')).toBeUndefined()
    expect(normalizeArtCraftId('!!!')).toBeUndefined()
  })
})

describe('parseInstalledJsonAll', () => {
  it('reads path aliases, cli stems, and display names from fields', () => {
    const text = JSON.stringify({
      apps: {
        photo: { path: '/apps/photo', cli: 'photo-cli', displayName: 'PhotoCraft', version: '1.0.0' },
      },
    })
    expect(parseInstalledJsonAll(text)).toEqual([
      { id: 'photo', displayName: 'PhotoCraft', installDir: '/apps/photo', version: '1.0.0', cliStem: 'photo-cli' },
    ])
  })

  it('enumerates every app in the per-app map', () => {
    const text = JSON.stringify({
      apps: {
        photocraft: { installDir: 'C:\\Apps\\PhotoCraft', version: '0.16.0' },
        figcraft: { installDir: 'C:\\Apps\\FigCraft' },
      },
    })
    expect(parseInstalledJsonAll(text)).toEqual([
      { id: 'photocraft', displayName: 'Photocraft', installDir: 'C:\\Apps\\PhotoCraft', version: '0.16.0' },
      { id: 'figcraft', displayName: 'Figcraft', installDir: 'C:\\Apps\\FigCraft' },
    ])
  })

  it('reads a flat record with an id field and ignores malformed payloads', () => {
    expect(parseInstalledJsonAll(JSON.stringify({ id: 'photo', installDir: '/apps/photo' }))).toEqual([
      { id: 'photo', displayName: 'Photo', installDir: '/apps/photo' },
    ])
    expect(parseInstalledJsonAll('{broken')).toEqual([])
    expect(parseInstalledJsonAll('[]')).toEqual([])
    expect(parseInstalledJsonAll(JSON.stringify({ apps: [] }))).toEqual([])
  })
})

describe('parseLauncherAppRonAll', () => {
  it('enumerates every per-app entry', () => {
    const text = String.raw`per_app:{"photocraft":"T:\\APPS\\PhotoCraft","figcraft":"T:\\APPS\\FigCraft"}`
    expect(parseLauncherAppRonAll(text)).toEqual([
      { id: 'photocraft', installDir: String.raw`T:\APPS\PhotoCraft` },
      { id: 'figcraft', installDir: String.raw`T:\APPS\FigCraft` },
    ])
  })

  it('returns empty when the map is absent', () => {
    expect(parseLauncherAppRonAll('nothing here')).toEqual([])
  })
})

describe('parseInstalledJsonAll edge cases', () => {
  it('ignores non-object entries and empty records', () => {
    expect(parseInstalledJsonAll(JSON.stringify({ apps: { bad: 'C:\\Apps', empty: {}, nil: null, list: [1] } }))).toEqual([])
    expect(parseInstalledJsonAll(JSON.stringify({ id: '!!!', installDir: '/apps' }))).toEqual([])
    expect(parseInstalledJsonAll(JSON.stringify({ id: 'photo', version: ' ' }))).toEqual([])
    expect(parseLauncherAppRonAll(String.raw`per_app:{"!!!":"/x","photo":""}`)).toEqual([])
  })
})

describe('listInstalledApps merge branches', () => {
  it('merges version-only, dir-only, and cli-stem entries without overwriting first fields', () => {
    const ronPath = win32.join('C:\\Users\\u', 'AppData', 'Roaming', 'ai.storyteller.artcraft-launcher', 'data', 'app.ron')
    const io = createIo({
      readText: (path) => {
        if (path === ronPath) return String.raw`per_app:{"samecraft":"T:\\FIRST","toolcraft":"T:\\TOOLS"}`
        if (path === win32.join(LAUNCHER_ROOT, 'installed.json')) {
          return JSON.stringify({
            apps: {
              samecraft: { version: '1.0.0', displayName: 'SameCraft', cliStem: 'same-cli' },
              toolcraft: { version: '2.0.0' },
              freshcraft: { version: '3.0.0' },
            },
          })
        }
        return undefined
      },
    })
    const apps = listInstalledApps(io)
    expect(apps).toEqual([
      { id: 'freshcraft', displayName: 'Freshcraft', version: '3.0.0', source: 'launcher-manifest' },
      { id: 'samecraft', displayName: 'Samecraft', installDir: 'T:\\FIRST', version: '1.0.0', cliStem: 'same-cli', source: 'launcher-state' },
      { id: 'toolcraft', displayName: 'Toolcraft', installDir: 'T:\\TOOLS', version: '2.0.0', source: 'launcher-state' },
    ])
  })

  it('records a first-seen manifest entry that carries a cli stem', () => {
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, 'installed.json')
        ? JSON.stringify({ apps: { firstcraft: { installDir: 'C:\\Apps\\First', cliStem: 'first-cli' } } })
        : undefined,
    })
    expect(listInstalledApps(io)).toEqual([
      { id: 'firstcraft', displayName: 'Firstcraft', installDir: 'C:\\Apps\\First', cliStem: 'first-cli', source: 'launcher-manifest' },
    ])
  })

  it('fills the install directory from the OS registry when the manifest omits it', () => {
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, 'installed.json')
        ? JSON.stringify({ apps: { versioncraft: { version: '1.0.0' } } })
        : undefined,
      registryInstallDirs: () => ({ VersionCraft: 'C:\\Apps\\Version' }),
    })
    expect(listInstalledApps(io)).toEqual([
      { id: 'versioncraft', displayName: 'Versioncraft', installDir: 'C:\\Apps\\Version', version: '1.0.0', source: 'launcher-manifest' },
    ])
  })

  it('ignores a desktop file whose stem is not a usable id', () => {
    const io = createIo({
      platform: 'linux',
      env: {},
      home: '/home/u',
      readText: () => 'Name=ArtCraft\nExec=photo\n',
      listDir: path => path === posix.join('/home/u', '.local', 'share', 'applications') ? ['artcraft-.desktop'] : [],
    })
    expect(listInstalledApps(io)).toEqual([])
  })

  it('reads an uppercase ArtCraft desktop file name', () => {
    const io = createIo({
      platform: 'linux',
      env: {},
      home: '/home/u',
      readText: path => path === posix.join('/home/u', '.local', 'share', 'applications', 'ARTCRAFT-PHOTO.desktop')
        ? 'Name=PhotoCraft\nExec=/opt/photo/photo-cli\n'
        : undefined,
      listDir: path => path === posix.join('/home/u', '.local', 'share', 'applications') ? ['ARTCRAFT-PHOTO.desktop'] : [],
    })
    expect(listInstalledApps(io).map(app => app.id)).toEqual(['photo'])
  })
})

describe('parseDesktopFile', () => {
  it('reads an ArtCraft desktop entry', () => {
    const entry = parseDesktopFile('Name=FigCraft\nExec=/opt/artcraft/figcraft run\n', 'artcraft-figcraft.desktop')
    expect(entry?.id).toBe('figcraft')
    expect(entry?.displayName).toBe('FigCraft')
    expect(entry?.installDir).toBe('/opt/artcraft')
  })

  it('ignores non-ArtCraft desktop files', () => {
    expect(parseDesktopFile('Name=GIMP\nExec=gimp\n', 'gimp.desktop')).toBeUndefined()
    expect(parseDesktopFile('Name=ArtCraft\nExec=photo\n', 'artcraft-.desktop')).toBeUndefined()
  })

  it('handles missing Name and Exec and a bare Exec command', () => {
    expect(parseDesktopFile('Other=1\n', 'artcraft-photo.desktop')).toEqual({ id: 'photo' })
    expect(parseDesktopFile('Name=PhotoCraft\nExec=photo-cli\n', 'artcraft-photo.desktop'))
      .toEqual({ id: 'photo', displayName: 'PhotoCraft' })
  })

  it('handles empty Name and Exec values', () => {
    expect(parseDesktopFile('Name=\nExec=\n', 'artcraft-photo.desktop')).toEqual({ id: 'photo' })
  })
})

describe('parseRegistryInstallDirs', () => {
  it('parses a registry query with blank values and stray lines', () => {
    const text = [
      '    stray    REG_SZ    x',
      'HKEY_LOCAL_MACHINE\\Software\\Empty',
      '    InstallDir    REG_SZ    ',
      'HKEY_LOCAL_MACHINE\\Software\\Blank',
      '    InstallDir    REG_EXPAND_SZ    D:\\Apps\\Blank',
    ].join('\r\n')
    expect(parseRegistryInstallDirs(text)).toEqual({ Blank: 'D:\\Apps\\Blank' })
  })

  it('parses every InstallDir block from a recursive query', () => {
    const text = [
      'HKEY_LOCAL_MACHINE\\Software\\PhotoCraft',
      '    InstallDir    REG_SZ    C:\\Apps\\PhotoCraft',
      '',
      'HKEY_LOCAL_MACHINE\\Software\\FigCraft',
      '    InstallDir    REG_EXPAND_SZ    D:\\Apps\\FigCraft',
      '',
      'HKEY_LOCAL_MACHINE\\Software\\Other',
      '    (Default)    REG_SZ    x',
    ].join('\r\n')
    expect(parseRegistryInstallDirs(text)).toEqual({
      PhotoCraft: 'C:\\Apps\\PhotoCraft',
      FigCraft: 'D:\\Apps\\FigCraft',
    })
  })
})

describe('listInstalledApps', () => {
  it('enumerates the launcher map without any hand-written manifest', () => {
    const text = JSON.stringify({
      apps: {
        photocraft: { installDir: 'C:\\Apps\\PhotoCraft', version: '0.16.0' },
        figcraft: { installDir: 'C:\\Apps\\FigCraft', version: '1.0.0' },
      },
    })
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, 'installed.json') ? text : undefined,
    })
    const apps = listInstalledApps(io)
    expect(apps.map(app => app.id)).toEqual(['figcraft', 'photocraft'])
    expect(apps[1]).toMatchObject({
      installDir: 'C:\\Apps\\PhotoCraft',
      version: '0.16.0',
      source: 'launcher-manifest',
    })
  })

  it('merges the launcher state, portable markers, and OS registry', () => {
    const ronPath = win32.join('C:\\Users\\u', 'AppData', 'Roaming', 'ai.storyteller.artcraft-launcher', 'data', 'app.ron')
    const io = createIo({
      readText: (path) => {
        if (path === ronPath) return String.raw`per_app:{"pdfcraft":"T:\\APPS\\PdfCraft"}`
        if (path === win32.join(LAUNCHER_ROOT, 'webcraft.portable.txt')) return ' T:\\APPS\\WebCraft '
        return undefined
      },
      listDir: path => path === LAUNCHER_ROOT ? ['webcraft.portable.txt'] : [],
      registryInstallDirs: () => ({ FigCraft: 'T:\\APPS\\FigCraft' }),
    })
    const apps = listInstalledApps(io)
    expect(apps.map(app => [app.id, app.source])).toEqual([
      ['figcraft', 'os-registry'],
      ['pdfcraft', 'launcher-state'],
      ['webcraft', 'portable-marker'],
    ])
  })

  it('enumerates Linux desktop entries alongside the launcher manifest', () => {
    const io = createIo({
      platform: 'linux',
      env: {},
      home: '/home/u',
      readText: (path) => {
        if (path === posix.join('/home/u', '.local', 'share', 'applications', 'artcraft-figcraft.desktop')) {
          return 'Name=FigCraft\nExec=/opt/artcraft/figcraft\n'
        }
        return undefined
      },
      listDir: path => path === posix.join('/home/u', '.local', 'share', 'applications')
        ? ['artcraft-figcraft.desktop']
        : [],
    })
    const apps = listInstalledApps(io)
    expect(apps).toEqual([
      { id: 'figcraft', displayName: 'FigCraft', installDir: '/opt/artcraft', source: 'desktop-entry' },
    ])
  })

  it('returns empty when nothing is installed', () => {
    expect(listInstalledApps(createIo())).toEqual([])
  })

  it('fills missing fields from a later source and ignores junk entries', () => {
    const ronPath = win32.join('C:\\Users\\u', 'AppData', 'Roaming', 'ai.storyteller.artcraft-launcher', 'data', 'app.ron')
    const io = createIo({
      readText: (path) => {
        if (path === ronPath) return String.raw`per_app:{"pdfcraft":"T:\\APPS\\PdfCraft"}`
        if (path === win32.join(LAUNCHER_ROOT, 'installed.json')) {
          return JSON.stringify({ apps: { pdfcraft: { version: '1.2.0', displayName: 'PdfCraft', cliStem: 'pdfcraft' } } })
        }
        if (path === win32.join(LAUNCHER_ROOT, 'bad.portable.txt')) return '   '
        if (path === win32.join(LAUNCHER_ROOT, 'x.portable.txt')) return undefined
        return undefined
      },
      listDir: path => path === LAUNCHER_ROOT ? ['other.json', 'x portable.txt', 'bad.portable.txt', 'x.portable.txt'] : [],
      registryInstallDirs: () => ({ '!!!': 'T:\\Nowhere', Empty: '   ' }),
    })
    const apps = listInstalledApps(io)
    expect(apps).toEqual([
      { id: 'pdfcraft', displayName: 'Pdfcraft', installDir: 'T:\\APPS\\PdfCraft', version: '1.2.0', cliStem: 'pdfcraft', source: 'launcher-state' },
    ])
  })

  it('keeps the first install directory when a later source repeats it', () => {
    const ronPath = win32.join('C:\\Users\\u', 'AppData', 'Roaming', 'ai.storyteller.artcraft-launcher', 'data', 'app.ron')
    const io = createIo({
      readText: (path) => {
        if (path === ronPath) return String.raw`per_app:{"pdfcraft":"T:\\APPS\\PdfCraft"}`
        if (path === win32.join(LAUNCHER_ROOT, 'installed.json')) {
          return JSON.stringify({ apps: { pdfcraft: { installDir: 'T:\\OTHER', version: '9.9.9' } } })
        }
        return undefined
      },
    })
    const apps = listInstalledApps(io)
    expect(apps).toEqual([
      { id: 'pdfcraft', displayName: 'Pdfcraft', installDir: 'T:\\APPS\\PdfCraft', version: '9.9.9', source: 'launcher-state' },
    ])
  })

  it('ignores unreadable and non-ArtCraft desktop files', () => {
    const io = createIo({
      platform: 'linux',
      env: {},
      home: '/home/u',
      readText: () => undefined,
      listDir: path => path === posix.join('/home/u', '.local', 'share', 'applications')
        ? ['artcraft-ghost.desktop', 'other.desktop', 'artcraft-notes.txt']
        : [],
    })
    expect(listInstalledApps(io)).toEqual([])
  })

  it('defaults the display name when no source declares one', () => {
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, 'installed.json')
        ? JSON.stringify({ apps: { webcraft: { installDir: '/apps/webcraft' } } })
        : undefined,
    })
    const apps = listInstalledApps(io)
    expect(apps).toEqual([{ id: 'webcraft', displayName: 'Webcraft', installDir: '/apps/webcraft', source: 'launcher-manifest' }])
  })

  it('honors an XDG data home and reads both applications directories', () => {
    const io = createIo({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/xdg' },
      home: '/home/u',
      readText: (path) => {
        if (path === posix.join('/usr', 'share', 'applications', 'artcraft-photo.desktop')) {
          return 'Name=PhotoCraft\nExec=/opt/photo/photo-cli\n'
        }
        return undefined
      },
      listDir: path => path === posix.join('/usr', 'share', 'applications') ? ['artcraft-photo.desktop', 'gimp.desktop'] : [],
    })
    expect(listInstalledApps(io).map(app => app.id)).toEqual(['photo'])
  })

  it('lists installed apps through the provider', async () => {
    const io = createIo({
      readText: path => path === win32.join(LAUNCHER_ROOT, 'installed.json')
        ? JSON.stringify({ apps: { figcraft: { installDir: 'C:\\Apps\\FigCraft' } } })
        : undefined,
    })
    const local: CraftLocalIo = {
      discovery: io,
      ensureDir: () => {},
      writeFile: () => {},
      spawn: () => { throw new Error('no spawn in inventory test') },
    }
    const provider = new CraftLocalProvider(local, { requestTimeoutMs: 1_000, graceMs: 1_000, closeGraceMs: 1_000 })
    await expect(provider.listInstalled({ signal: new AbortController().signal })).resolves.toMatchObject([
      { id: 'figcraft', source: 'launcher-manifest' },
    ])
    await expect(provider.listInstalled({ signal: AbortSignal.abort() })).rejects.toThrow()
  })

  it('tolerates a discovery seam without a directory listing primitive', () => {
    const io = createIo({
      platform: 'linux',
      env: {},
      home: '/home/u',
    })
    expect(listInstalledApps(io)).toEqual([])
  })

  it('falls back to the home data directory when XDG_DATA_HOME is empty', () => {
    const io = createIo({
      platform: 'linux',
      env: { XDG_DATA_HOME: '' },
      home: '/home/u',
      listDir: () => [],
    })
    expect(listInstalledApps(io)).toEqual([])
  })
})
