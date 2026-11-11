/**
 * External application catalogue and file-manager reveal behavior.
 *
 * The host seam is injected (platform, environment, existence probe, command
 * runner), so every case runs identically on every platform.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import {
  canRevealNativePath,
  EXTERNAL_APPS,
  externalAppAvailability,
  launchExternalApp,
  revealNativePath,
  type NativeCommandRunner,
} from '../src/index.ts'

const signal = (): AbortController => new AbortController()

/** Existence probe that accepts exactly the listed paths. */
const present = (...paths: string[]): ((path: string) => boolean) => {
  const set = new Set(paths)
  return (path: string) => set.has(path)
}

/** A real directory, so the reveal adapter's directory probe has a subject. */
async function makeTempDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'gnk-external-app-'))
}

describe('external application catalogue', () => {
  it('reports every catalogue entry in catalogue order', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, { platform: 'linux', exists: () => false })
    expect(rows.map(row => row.id)).toEqual(EXTERNAL_APPS.map(spec => spec.id))
    expect(rows.every(row => !row.available)).toBe(true)
  })

  it('finds a PATH command on the host platform', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'linux',
      env: { PATH: ['/usr/bin', '/usr/local/bin'].join(delimiter) },
      exists: present('/usr/local/bin/cursor'),
    })
    expect(rows.find(row => row.id === 'cursor')?.available).toBe(true)
    expect(rows.find(row => row.id === 'vscode')?.available).toBeFalsy()
  })

  it('resolves a Windows command through the executable suffixes', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'win32',
      env: { PATH: 'C:\\tools' },
      exists: present('C:\\tools\\code.cmd'),
    })
    expect(rows.find(row => row.id === 'vscode')?.available).toBe(true)
  })

  it('falls back to the Windows local application data install path', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'win32',
      env: { PATH: '', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
      exists: present('C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'),
    })
    expect(rows.find(row => row.id === 'vscode')?.available).toBe(true)
  })

  it('accepts an installed macOS application bundle', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'darwin',
      env: { PATH: '' },
      exists: present('/Applications/Cursor.app'),
    })
    expect(rows.find(row => row.id === 'cursor')?.available).toBe(true)
    expect(rows.find(row => row.id === 'github-desktop')?.available).toBeFalsy()
  })

  it('accepts a bundle installed in the macOS Utilities folder', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'darwin',
      env: { PATH: '' },
      exists: present('/Applications/Utilities/Visual Studio Code.app'),
    })
    expect(rows.find(row => row.id === 'vscode')?.available).toBe(true)
  })

  it('reads the Windows PATH spelling and an absent PATH alike', () => {
    const windowsPath = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'win32',
      env: { Path: 'C:\\tools' },
      exists: present('C:\\tools\\code.exe'),
    })
    expect(windowsPath.find(row => row.id === 'vscode')?.available).toBe(true)

    const noPath = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'win32',
      env: {},
      exists: () => false,
    })
    expect(noPath.every(row => !row.available)).toBe(true)
  })

  it('reports a platform with no catalogue command as unavailable', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS, {
      platform: 'aix',
      env: { PATH: '/usr/bin' },
      exists: () => false,
    })
    expect(rows.every(row => !row.available)).toBe(true)
  })

  it('resolves a command that already spells a path', () => {
    const rows = externalAppAvailability([{
      id: 'by-path',
      commands: { linux: ['/opt/tools/editor'] },
      macAppName: 'Editor',
      bundleId: 'com.example.editor',
      localAppDataPaths: [],
    }], {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      exists: present('/opt/tools/editor'),
    })
    expect(rows[0]?.available).toBe(true)
  })

  it('reports a path command that is absent', () => {
    const rows = externalAppAvailability([{
      id: 'by-path',
      commands: { linux: ['/opt/tools/editor'] },
      macAppName: 'Editor',
      bundleId: 'com.example.editor',
      localAppDataPaths: [],
    }], {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      exists: () => false,
    })
    expect(rows[0]?.available).toBeFalsy()
  })

  it('probes the host catalogue when no seam is supplied', () => {
    const rows = externalAppAvailability(EXTERNAL_APPS)
    expect(rows.map(row => row.id)).toEqual(EXTERNAL_APPS.map(spec => spec.id))
  })
})

describe('external application launch', () => {
  it('launches the resolved executable with the path as one argument', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await launchExternalApp('cursor', '/projects/app', signal().signal, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      exists: present('/usr/bin/cursor'),
      run,
    })
    expect(run).toHaveBeenCalledWith('/usr/bin/cursor', ['/projects/app'], expect.any(AbortSignal))
  })

  it('opens a macOS bundle by identifier when no command exists', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await launchExternalApp('vscode', '/projects/app', signal().signal, {
      platform: 'darwin',
      env: { PATH: '' },
      exists: present('/Applications/Visual Studio Code.app'),
      run,
    })
    expect(run).toHaveBeenCalledWith('open', ['-b', 'com.microsoft.VSCode', '/projects/app'], expect.any(AbortSignal))
  })

  it('refuses an unknown application id', async () => {
    await expect(launchExternalApp('emacs', '/projects/app', signal().signal, {
      platform: 'linux',
      env: { PATH: '' },
      exists: () => false,
    })).rejects.toThrow('unknown external application "emacs"')
  })

  it('refuses an application that is not installed on this host', async () => {
    await expect(launchExternalApp('cursor', '/projects/app', signal().signal, {
      platform: 'linux',
      env: { PATH: '' },
      exists: () => false,
    })).rejects.toThrow('external application "cursor" is not installed on this host')
  })

  it('does not launch after the caller aborts', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    const aborted = new AbortController()
    aborted.abort()
    await expect(launchExternalApp('cursor', '/projects/app', aborted.signal, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      exists: present('/usr/bin/cursor'),
      run,
    })).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an application that is missing on this host', async () => {
    await expect(launchExternalApp('cursor', '/projects/app', signal().signal, {
      exists: () => false,
    })).rejects.toThrow(/not installed on this host/)
  })

  it('probes the host filesystem when no existence seam is supplied', async () => {
    await expect(launchExternalApp('cursor', '/projects/app', signal().signal, { platform: 'aix' }))
      .rejects.toThrow(/not installed on this host/)
  })

  it('refuses a macOS application whose bundle is absent', async () => {
    await expect(launchExternalApp('cursor', '/projects/app', signal().signal, {
      platform: 'darwin',
      env: { PATH: '' },
      exists: () => false,
    })).rejects.toThrow(/not installed on this host/)
  })
})

describe('native path reveal', () => {
  it('reveals a directory in the Windows file manager', async () => {
    const directory = await makeTempDirectory()
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath(directory, signal().signal, { platform: 'win32', run })
    expect(run).toHaveBeenCalledWith('explorer.exe', [directory], expect.any(AbortSignal))
  })

  it('selects a file in the Windows file manager', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath('C:\\projects\\app\\readme.md', signal().signal, { platform: 'win32', run })
    expect(run).toHaveBeenCalledWith(
      'explorer.exe',
      ['/select,C:\\projects\\app\\readme.md'],
      expect.any(AbortSignal),
    )
  })

  it('opens a directory on macOS', async () => {
    const directory = await makeTempDirectory()
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath(directory, signal().signal, { platform: 'darwin', run })
    expect(run).toHaveBeenCalledWith('open', [directory], expect.any(AbortSignal))
  })

  it('opens a directory on Linux', async () => {
    const directory = await makeTempDirectory()
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath(directory, signal().signal, { platform: 'linux', run })
    expect(run).toHaveBeenCalledWith('xdg-open', [directory], expect.any(AbortSignal))
  })

  it('selects a file inside its folder on macOS', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath('/projects/app/readme.md', signal().signal, { platform: 'darwin', run })
    expect(run).toHaveBeenCalledWith('open', ['-R', '/projects/app/readme.md'], expect.any(AbortSignal))
  })

  it('opens the containing folder on Linux', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath('/projects/app/readme.md', signal().signal, { platform: 'linux', run })
    expect(run).toHaveBeenCalledWith('xdg-open', ['/projects/app/readme.md/..'], expect.any(AbortSignal))
  })

  it('refuses a platform without a file manager', async () => {
    await expect(revealNativePath('/projects/app', signal().signal, { platform: 'aix' }))
      .rejects.toThrow('native path reveal is unsupported on aix')
  })

  it('reads the host platform when no seam is supplied', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    await revealNativePath('/projects/app', signal().signal, { run })
    expect(run).toHaveBeenCalledOnce()
  })
})

describe('reveal availability', () => {
  it('reports the desktop platforms as revealable', () => {
    expect(canRevealNativePath({ platform: 'win32' })).toBe(true)
    expect(canRevealNativePath({ platform: 'darwin' })).toBe(true)
  })

  it('requires a display server on Linux', () => {
    expect(canRevealNativePath({ platform: 'linux', env: {} })).toBe(false)
    expect(canRevealNativePath({ platform: 'linux', env: { DISPLAY: ':0' } })).toBe(true)
    expect(canRevealNativePath({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe(true)
  })

  it('reads the host environment when no seam is supplied', () => {
    expect(typeof canRevealNativePath({ platform: 'linux' })).toBe('boolean')
  })

  it('refuses a platform without a desktop', () => {
    expect(canRevealNativePath({ platform: 'aix', env: {} })).toBe(false)
  })

  it('reads the host platform when no seam is supplied', () => {
    expect(typeof canRevealNativePath()).toBe('boolean')
  })
})
