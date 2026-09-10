/**
 * Frameless-window chrome for Greeneek Desktop (Windows and Linux): a 40 px
 * drag strip overlaid on the web UI with small custom window controls pinned
 * to the top-right (minimize, maximize/restore, close). The controls are
 * built by an injected script so every page the window shows — the splash
 * and the web UI alike — carries identical chrome without forking the UI.
 * The strip is a pure overlay: the hosted client keeps its sidebar
 * background flush to the window top and offsets its own content below the
 * strip (data-desktop-host), so no body padding is injected here.
 * Buttons resolve the `greeneekDesktop` preload bridge at click time and warn
 * once when it is absent; the main process pushes maximize-state changes
 * back into `__gnkTitlebarSync`.
 */
export const FRAMELESS_TITLEBAR_HEIGHT = 40

export const FRAMELESS_TITLEBAR_CSS = `
  html {
    background-color: Canvas;
  }

  #gnk-titlebar-strip {
    position: fixed;
    z-index: 2147483647;
    top: 0;
    left: 0;
    width: 100%;
    height: ${FRAMELESS_TITLEBAR_HEIGHT}px;
    -webkit-app-region: drag;
    app-region: drag;
  }

  #gnk-titlebar-controls {
    position: fixed;
    z-index: 2147483647;
    top: 0;
    right: 0;
    display: flex;
    height: ${FRAMELESS_TITLEBAR_HEIGHT}px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  #gnk-titlebar-controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: ${FRAMELESS_TITLEBAR_HEIGHT}px;
    padding: 0;
    border: 0;
    background: transparent;
    color: CanvasText;
    cursor: pointer;
  }

  #gnk-titlebar-controls button:hover {
    background-color: color-mix(in srgb, CanvasText 12%, transparent);
  }

  #gnk-titlebar-controls button:active {
    background-color: color-mix(in srgb, CanvasText 20%, transparent);
  }

  #gnk-titlebar-controls button[data-action="close"]:hover {
    background-color: #e81123;
    color: #ffffff;
  }

  #gnk-titlebar-controls button svg {
    width: 11px;
    height: 11px;
  }

  body {
    box-sizing: border-box !important;
    height: 100vh !important;
    background-color: var(--dsw-alias-bg-base, Canvas) !important;
    overflow: hidden !important;
  }
`

const ICONS = {
  minimize: '<svg viewBox="0 0 11 11" aria-hidden="true"><path d="M1 5.5h9" stroke="currentColor" stroke-width="1.2"/></svg>',
  maximize: '<svg viewBox="0 0 11 11" aria-hidden="true"><rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  restore: '<svg viewBox="0 0 11 11" aria-hidden="true"><path d="M3.5 1.5h6v6M1.5 3.5v6h6v-6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  close: '<svg viewBox="0 0 11 11" aria-hidden="true"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>',
}

/**
 * Renderer script that builds the custom window controls. Idempotent: a
 * second injection (navigation, reload) reuses the existing nodes.
 * @returns the script source for `executeJavaScript`.
 */
export function framelessTitlebarScript() {
  return `
(() => {
  // Resolved at click time, not inject time: a navigation that lands before
  // the preload attaches must not pin dead buttons for the page lifetime.
  const controlsApi = () => {
    const bridge = window.greeneekDesktop;
    return bridge && typeof bridge.windowMinimize === 'function' ? bridge : null;
  };
  let warnedMissingBridge = false;
  const apiOrWarn = () => {
    const api = controlsApi();
    if (!api && !warnedMissingBridge) {
      warnedMissingBridge = true;
      console.warn('Greeneek window controls: preload bridge unavailable.');
    }
    return api;
  };
  const ACTIONS = [
    { action: 'minimize', label: 'Minimize', icon: ${JSON.stringify(ICONS.minimize)} },
    { action: 'toggle-maximize', label: 'Maximize', restoreLabel: 'Restore', icon: ${JSON.stringify(ICONS.maximize)}, restoreIcon: ${JSON.stringify(ICONS.restore)} },
    { action: 'close', label: 'Close', icon: ${JSON.stringify(ICONS.close)} },
  ];
  let strip = document.getElementById('gnk-titlebar-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'gnk-titlebar-strip';
    document.documentElement.appendChild(strip);
  }
  let controls = document.getElementById('gnk-titlebar-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.id = 'gnk-titlebar-controls';
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', 'Window controls');
    for (const entry of ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = entry.action;
      button.title = entry.label;
      button.setAttribute('aria-label', entry.label);
      button.innerHTML = entry.icon;
      button.addEventListener('click', () => {
        const api = apiOrWarn();
        if (!api) return;
        if (entry.action === 'minimize') api.windowMinimize();
        else if (entry.action === 'toggle-maximize') api.windowToggleMaximize();
        else api.windowClose();
      });
      controls.appendChild(button);
    }
    document.documentElement.appendChild(controls);
    strip.addEventListener('dblclick', () => {
      const api = apiOrWarn();
      if (api) api.windowToggleMaximize();
    });
  }
  const sync = (maximized) => {
    const button = controls.querySelector('[data-action="toggle-maximize"]');
    if (!button) return;
    const entry = ACTIONS[1];
    const label = maximized ? entry.restoreLabel : entry.label;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = maximized ? entry.restoreIcon : entry.icon;
  };
  window.__gnkTitlebarSync = sync;
  const api = controlsApi();
  if (api && api.windowIsMaximized) {
    api.windowIsMaximized().then(
      ({ maximized }) => sync(maximized === true),
      () => {},
    );
  }
})();`
}

/**
 * Paint the frameless chrome on one window's current page (call on every
 * `did-finish-load`: splash and web UI alike).
 * @param webContents - the window's webContents.
 * @returns nothing.
 */
export async function applyFramelessTitleBar(webContents) {
  await webContents.insertCSS(FRAMELESS_TITLEBAR_CSS)
  await webContents.executeJavaScript(framelessTitlebarScript())
}

/**
 * Push maximize-state into the injected controls (call on the window's
 * `maximize` / `unmaximize` events).
 * @param webContents - the window's webContents.
 * @param maximized - whether the window is now maximized.
 * @returns nothing.
 */
export async function syncFramelessMaximizeIcon(webContents, maximized) {
  try {
    await webContents.executeJavaScript(`window.__gnkTitlebarSync && window.__gnkTitlebarSync(${maximized === true ? 'true' : 'false'})`)
  } catch {
    // The page may be mid-navigation with no controls yet; the script
    // self-syncs on its next injection.
  }
}
