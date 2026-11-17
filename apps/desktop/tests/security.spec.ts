/** Desktop browser-partition policy: only declared profiles may attach as webviews. */
import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PARTITIONS, isAllowedBrowserPartition, secureWindow,
} from '../src/security.js'

/** Fake webContents capturing handlers. */
function fakeWebContents() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const webContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler) }),
    getURL: () => 'http://127.0.0.1:3080/',
    session: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    },
  }
  return { webContents, handlers }
}

describe('desktop browser partition policy', () => {
  it('accepts only the two declared profiles', () => {
    expect(BROWSER_PARTITIONS).toEqual(['persist:gnk-browser-default', 'gnk-browser-incognito'])
    expect(isAllowedBrowserPartition('persist:gnk-browser-default')).toBe(true)
    expect(isAllowedBrowserPartition('gnk-browser-incognito')).toBe(true)
    expect(isAllowedBrowserPartition('persist:evil')).toBe(false)
    expect(isAllowedBrowserPartition(undefined)).toBe(false)
  })

  it('hardens an accepted webview and refuses an arbitrary partition', () => {
    const { webContents, handlers } = fakeWebContents()
    secureWindow(webContents, { openExternal: vi.fn() })
    const attach = handlers.get('will-attach-webview')
    expect(attach).toBeTypeOf('function')

    const denied = { preventDefault: vi.fn() }
    const preferences = {}
    attach?.(denied, preferences, { partition: 'persist:evil' })
    expect(denied.preventDefault).toHaveBeenCalledOnce()

    const allowed = { preventDefault: vi.fn() }
    attach?.(allowed, preferences, { partition: 'gnk-browser-incognito' })
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(preferences).toMatchObject({
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      webSecurity: true,
    })
  })
})
