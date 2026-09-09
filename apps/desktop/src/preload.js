import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload bridge: the sandboxed renderer's only host surface for the About
 * section. No DOM access here — the web UI calls these and renders the
 * answers itself. Versions resolve from real manifests; update download and
 * install stay consent-gated in the update manager.
 */
contextBridge.exposeInMainWorld('greeneekDesktop', {
  /** Installed versions: `{ desktop, harness }` (harness may be undefined). */
  versions: () => ipcRenderer.invoke('greeneek-desktop:versions'),
  /** Update state: `{ state }` (one of UPDATE_STATES). */
  updateStatus: () => ipcRenderer.invoke('greeneek-desktop:update-status'),
  /** User-invoked check; resolves to the fresh `{ state }`. */
  checkForUpdates: () => ipcRenderer.invoke('greeneek-desktop:check-updates'),
  /** Restart into the downloaded update; no-op until one is downloaded. */
  installUpdate: () => ipcRenderer.invoke('greeneek-desktop:install-update'),
  /** Minimize the frameless window. */
  windowMinimize: () => ipcRenderer.invoke('greeneek-desktop:window-minimize'),
  /** Toggle maximize/restore on the frameless window. */
  windowToggleMaximize: () => ipcRenderer.invoke('greeneek-desktop:window-toggle-maximize'),
  /** Close the frameless window (tray rules still apply). */
  windowClose: () => ipcRenderer.invoke('greeneek-desktop:window-close'),
  /** Whether the frameless window is currently maximized. */
  windowIsMaximized: () => ipcRenderer.invoke('greeneek-desktop:window-is-maximized'),
})
