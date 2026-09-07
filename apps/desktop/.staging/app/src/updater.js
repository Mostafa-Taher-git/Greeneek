import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { updateSkipPath } from './paths.js'

/**
 * Consent-based self-update from GitHub Releases (electron-updater).
 * An available update is offered, never fetched: download starts on explicit
 * consent, install starts on explicit Restart-and-install. One version can be
 * skipped without suppressing later ones; a manual check re-offers a skipped
 * version. Update logs carry versions only — never service URLs or tokens.
 */

/** Update states the UI (tray label today) may observe. */
export const UPDATE_STATES = [
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'up-to-date',
  'error',
  'unsupported',
]

/**
 * Whether this install can self-update, and why not when it cannot.
 * Windows self-updates only from an installed location (running the NSIS
 * installer from a portable copy would plant a second copy of the app);
 * Linux self-updates only as an AppImage (dpkg needs root, which the updater
 * must not attempt); anything else is notify-only.
 * @param options - platform, executable path, and environment.
 * @returns `{ capable, reason? }`.
 */
export function updateCapabilities({ platform, exePath, env = process.env }) {
  if (platform === 'win32') {
    const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)']]
      .filter((dir) => typeof dir === 'string' && dir !== '')
      .map((dir) => dir.toLowerCase())
    const installed = programFiles.some((dir) => exePath.toLowerCase().startsWith(dir))
    return installed
      ? { capable: true }
      : { capable: false, reason: 'portable installs update from the releases page' }
  }
  if (platform === 'linux') {
    return env.APPIMAGE !== undefined && env.APPIMAGE !== ''
      ? { capable: true }
      : { capable: false, reason: 'deb installs update through the package manager' }
  }
  return { capable: false, reason: `self-update is not supported on ${platform}` }
}

/**
 * Whether an available version should be offered.
 * A manual check re-offers a skipped version (the unskip path); a newer
 * version is always offered.
 * @param version - the available version.
 * @param skippedVersion - the remembered skip, if any.
 * @param manual - whether the check was user-invoked.
 * @returns true when the offer dialog should show.
 */
export function shouldOfferUpdate(version, skippedVersion, manual) {
  return manual === true || version !== skippedVersion
}

/**
 * Read the remembered skip.
 * @param userData - the app's userData directory.
 * @param readFileImpl - injectable for tests.
 * @returns the skipped version, or undefined when none/invalid.
 */
export async function readSkippedVersion(userData, readFileImpl = readFile) {
  try {
    const raw = await readFileImpl(updateSkipPath(userData), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed?.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Remember (or clear) the skipped version.
 * @param userData - the app's userData directory.
 * @param version - the version to skip, or undefined to clear.
 * @param deps - injectable file operations for tests.
 * @returns nothing.
 */
export async function writeSkippedVersion(userData, version, { writeFileImpl = writeFile, rmImpl = rm } = {}) {
  const path = updateSkipPath(userData)
  if (version === undefined) {
    await rmImpl(path, { force: true }).catch(() => undefined)
    return
  }
  await writeFileImpl(path, JSON.stringify({ version }, null, 2), 'utf8')
}

/**
 * Create the update manager. All Electron objects arrive as arguments so the
 * policy above stays unit-testable and this wiring stays thin.
 * @param deps - app, autoUpdater, dialog, shell, log, userData, platform, exePath, env.
 * @returns `{ checkForUpdates, quitAndInstall, getState, onStateChange, stop }`.
 */
export function createUpdateManager({
  app,
  autoUpdater,
  dialog,
  shell,
  log,
  userData,
  platform = process.platform,
  exePath = app.getPath('exe'),
  env = process.env,
  releasePage = 'https://github.com/Mostafa-Taher-git/Greeneek/releases/latest',
}) {
  const capabilities = updateCapabilities({ platform, exePath, env })
  let state = 'idle'
  const listeners = new Set()
  let checking = false
  let availableVersion
  let availableNotes
  let timer
  let stopped = false

  const setState = (next) => {
    state = next
    for (const listener of listeners) {
      try {
        listener(next)
      } catch {
        // Observer failures must never break the update flow.
      }
    }
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  if (typeof autoUpdater.logger !== 'undefined' && log !== undefined) {
    autoUpdater.logger = log
  }

  const offerDownload = async (version, notes) => {
    setState('available')
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: `Greeneek ${version} is available`,
      message: `Greeneek ${version} is available.`,
      detail: notes ?? 'See the release notes for details.',
      buttons: capabilities.capable
        ? ['Download', 'Skip this version', 'Later']
        : ['Download page', 'Skip this version', 'Later'],
      defaultId: 0,
      cancelId: 2,
    })
    if (response === 1) {
      await writeSkippedVersion(userData, version)
      setState('idle')
      return
    }
    if (response !== 0) {
      setState('idle')
      return
    }
    if (!capabilities.capable) {
      await writeSkippedVersion(userData, undefined)
      await shell.openExternal(releasePage)
      setState('idle')
      return
    }
    setState('downloading')
    await autoUpdater.downloadUpdate()
  }

  const offerInstall = async (version) => {
    setState('downloaded')
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: `Greeneek ${version} is ready`,
      message: `Greeneek ${version} downloaded — restart to install?`,
      detail: 'Your profiles, sessions, and settings are preserved.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      quitAndInstall()
    } else {
      setState('idle')
    }
  }

  autoUpdater.on('update-available', (info) => {
    availableVersion = info.version
    availableNotes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((note) => note?.note).filter(Boolean).join('\n')
      : typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined
    void (async () => {
      const skipped = await readSkippedVersion(userData)
      if (!shouldOfferUpdate(info.version, skipped, checkingManual)) {
        checkingManual = false
        setState('idle')
        return
      }
      await offerDownload(info.version, availableNotes)
      checkingManual = false
    })()
  })

  autoUpdater.on('update-downloaded', (info) => {
    checkingManual = false
    void offerInstall(info.version)
  })

  autoUpdater.on('update-not-available', () => {
    if (checkingManual) {
      checkingManual = false
      setState('up-to-date')
      void dialog.showMessageBox({
        type: 'info',
        title: 'Greeneek is up to date',
        message: 'You are running the latest version.',
        buttons: ['OK'],
      })
    } else {
      setState('idle')
    }
  })

  autoUpdater.on('error', (error) => {
    log?.error?.(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
    if (checkingManual) {
      checkingManual = false
      setState('error')
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: 'The next automatic check will retry silently.',
        buttons: ['OK'],
      })
      setTimeout(() => {
        if (state === 'error') setState('idle')
      }, 8000).unref?.()
    } else {
      setState('idle')
    }
  })

  let checkingManual = false

  const checkForUpdates = async ({ manual = false } = {}) => {
    if (!app.isPackaged) {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Check for updates',
          message: 'Automatic updates are available in packaged builds only.',
          buttons: ['OK'],
        })
      }
      return
    }
    if (checking) return
    checking = true
    checkingManual = manual
    setState('checking')
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      log?.error?.(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
      checking = false
      checkingManual = false
      setState(manual ? 'error' : 'idle')
    } finally {
      checking = false
    }
  }

  let prepareToInstall = async () => undefined

  const quitAndInstall = () => {
    void (async () => {
      try {
        await prepareToInstall()
      } finally {
        autoUpdater.quitAndInstall(false, true)
      }
    })()
  }

  const schedule = () => {
    const jitter = Math.floor(Math.random() * 15_000)
    timer = setTimeout(() => {
      void checkForUpdates()
      timer = setInterval(() => {
        void checkForUpdates()
      }, 6 * 60 * 60 * 1000)
      timer.unref?.()
    }, 15_000 + jitter)
    timer.unref?.()
  }

  return {
    checkForUpdates,
    quitAndInstall,
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setPrepareToInstall: (hook) => {
      prepareToInstall = hook
    },
    start: () => schedule(),
    stop: () => {
      stopped = true
      if (timer !== undefined) {
        clearTimeout(timer)
        clearInterval(timer)
      }
    },
    isStopped: () => stopped,
  }
}
