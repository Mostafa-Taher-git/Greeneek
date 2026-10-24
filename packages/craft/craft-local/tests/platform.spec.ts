import { describe, expect, it } from 'vitest'
import { loadPilotCatalog } from '@greeneek/gnk-craft'
import {
  cliExecutableName,
  compareVersions,
  guiExecutableName,
  launcherRoots,
  meetsVersionFloor,
  parseInstalledJson,
  parseRegistryInstallDir,
} from '../src/platform.ts'

const catalog = loadPilotCatalog()
const photocraft = catalog.require('photocraft')
const pdfcraft = catalog.require('pdfcraft')

describe('cliExecutableName', () => {
  it('adds the Windows executable suffix', () => {
    expect(cliExecutableName('photocraft', 'win32')).toBe('photocraft-cli.exe')
  })

  it('keeps the bare stem elsewhere', () => {
    expect(cliExecutableName('photocraft', 'darwin')).toBe('photocraft-cli')
    expect(cliExecutableName('photocraft', 'linux')).toBe('photocraft-cli')
  })
})

describe('guiExecutableName', () => {
  it('adds the Windows executable suffix', () => {
    expect(guiExecutableName('pdfcraft', 'win32')).toBe('pdfcraft.exe')
  })

  it('keeps the bare stem elsewhere', () => {
    expect(guiExecutableName('pdfcraft', 'linux')).toBe('pdfcraft')
  })
})

describe('launcherRoots', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    expect(launcherRoots('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u'))
      .toEqual(['C:\\Users\\u\\AppData\\Local\\ArtCraft Launcher'])
  })

  it('falls back to the home directory when LOCALAPPDATA is absent or empty', () => {
    expect(launcherRoots('win32', {}, 'C:\\Users\\u'))
      .toEqual(['C:\\Users\\u\\AppData\\Local\\ArtCraft Launcher'])
    expect(launcherRoots('win32', { LOCALAPPDATA: '' }, 'C:\\Users\\u'))
      .toEqual(['C:\\Users\\u\\AppData\\Local\\ArtCraft Launcher'])
  })

  it('uses Application Support on macOS', () => {
    expect(launcherRoots('darwin', {}, '/Users/u'))
      .toEqual(['/Users/u/Library/Application Support/ArtCraft Launcher'])
  })

  it('uses XDG_DATA_HOME on Linux', () => {
    expect(launcherRoots('linux', { XDG_DATA_HOME: '/data' }, '/home/u'))
      .toEqual(['/data/artcraft-launcher'])
  })

  it('falls back to ~/.local/share on Linux when XDG_DATA_HOME is absent or empty', () => {
    expect(launcherRoots('linux', {}, '/home/u')).toEqual(['/home/u/.local/share/artcraft-launcher'])
    expect(launcherRoots('linux', { XDG_DATA_HOME: '' }, '/home/u')).toEqual(['/home/u/.local/share/artcraft-launcher'])
  })
})

describe('parseInstalledJson', () => {
  it('reads the flat record shape', () => {
    expect(parseInstalledJson(JSON.stringify({ installDir: 'C:\\Apps\\PhotoCraft', version: '1.2.3' }), photocraft))
      .toEqual({ installDir: 'C:\\Apps\\PhotoCraft', version: '1.2.3' })
  })

  it('reads the per-app map shape by canonical id', () => {
    const text = JSON.stringify({ apps: { photocraft: { installDir: '/apps/photo', version: '2.0.0' } } })
    expect(parseInstalledJson(text, photocraft)).toEqual({ installDir: '/apps/photo', version: '2.0.0' })
  })

  it('falls back to an alias key when the canonical id is absent', () => {
    const text = JSON.stringify({ apps: { printcraft: { installDir: '/apps/pdf' } } })
    expect(parseInstalledJson(text, pdfcraft)).toEqual({ installDir: '/apps/pdf' })
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseInstalledJson('{not json', photocraft)).toBeUndefined()
  })

  it('returns undefined for non-object JSON values', () => {
    expect(parseInstalledJson('null', photocraft)).toBeUndefined()
    expect(parseInstalledJson('[]', photocraft)).toBeUndefined()
    expect(parseInstalledJson('"path"', photocraft)).toBeUndefined()
  })

  it('returns undefined when the apps map does not select an object', () => {
    expect(parseInstalledJson(JSON.stringify({ apps: { photocraft: 'C:\\Apps' } }), photocraft)).toBeUndefined()
    expect(parseInstalledJson(JSON.stringify({ apps: [] }), photocraft)).toBeUndefined()
  })

  it('drops empty string values', () => {
    expect(parseInstalledJson(JSON.stringify({ installDir: '   ', version: ' 1.0.0 ' }), photocraft))
      .toEqual({ version: '1.0.0' })
    expect(parseInstalledJson(JSON.stringify({ installDir: '/apps', version: '' }), photocraft))
      .toEqual({ installDir: '/apps' })
    expect(parseInstalledJson(JSON.stringify({ installDir: 42 }), photocraft)).toBeUndefined()
  })
})

describe('parseRegistryInstallDir', () => {
  it('reads an InstallDir REG_SZ value', () => {
    const text = [
      '',
      'HKEY_LOCAL_MACHINE\\Software\\PhotoCraft',
      '    InstallDir    REG_SZ    C:\\Program Files\\ArtCraft\\PhotoCraft',
      '',
    ].join('\r\n')
    expect(parseRegistryInstallDir(text)).toBe('C:\\Program Files\\ArtCraft\\PhotoCraft')
  })

  it('reads an InstallDir REG_EXPAND_SZ value', () => {
    expect(parseRegistryInstallDir('    InstallDir    REG_EXPAND_SZ    D:\\Apps\\PdfCraft'))
      .toBe('D:\\Apps\\PdfCraft')
  })

  it('returns undefined when the value is absent or empty', () => {
    expect(parseRegistryInstallDir('no values here')).toBeUndefined()
    expect(parseRegistryInstallDir('    InstallDir    REG_SZ    ')).toBeUndefined()
  })
})

describe('compareVersions', () => {
  it('orders numeric triples', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('returns undefined for an unparseable value', () => {
    expect(compareVersions('alpha', '1.0.0')).toBeUndefined()
    expect(compareVersions('1.0.0', 'latest')).toBeUndefined()
  })
})

describe('meetsVersionFloor', () => {
  it('accepts a missing version because it cannot be proven old', () => {
    expect(meetsVersionFloor(undefined, '1.0.0')).toBe(true)
  })

  it('accepts a version at or above the floor', () => {
    expect(meetsVersionFloor('1.0.0', '1.0.0')).toBe(true)
    expect(meetsVersionFloor('1.1.0', '1.0.0')).toBe(true)
  })

  it('rejects a known-old version', () => {
    expect(meetsVersionFloor('0.9.9', '1.0.0')).toBe(false)
  })

  it('accepts an unparseable version because the vendor suffix grammar is unverified', () => {
    expect(meetsVersionFloor('2024-beta', '1.0.0')).toBe(true)
  })
})
