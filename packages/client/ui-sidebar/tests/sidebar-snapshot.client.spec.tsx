// @vitest-environment jsdom
/**
 * Local DOM snapshots of the sidebar shell through the real assembly path:
 * SlotTestRuntime mounts the package apply on its own fiber, the auto frame
 * supplies the layout's owner share at the render site, and the snapshot
 * captures exactly the 'sidebar' slot's output (CSS-module class names
 * folded to their semantic locals by the runtime's serializer). The child
 * holes (sidebar.workspaces / sidebar.settings) have no registrant here, so
 * the snapshots pin the shell chrome itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@greeneek/gnk-client-test-runtime'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { ar as commonAr } from '@greeneek/gnk-client-locale/src/locales/ar.ts'
import { en as commonEn } from '@greeneek/gnk-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import { apply, inject } from '@greeneek/gnk-client-ui-sidebar/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

beforeEach(() => {
  vi.stubEnv('GNK_CLIENT_COMMIT_HASH', 'abc1234')
  vi.stubEnv('GNK_CLIENT_GIT_DIRTY', 'true')
  vi.stubEnv('GNK_CLIENT_VERSION', '1.2.3-rc.4')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/**
 * Boot the package over the slot test runtime. The default bench stays on
 * the service's default locale (zh — the fallback chain's base), pinning
 * what an untouched client shows; `locale: 'en'` pins the en copy instead.
 * The installed face backs the entry's standard `t` seat either way.
 */
async function bench(options: { locale?: 'en' } = {}) {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('layout', { toggleSidebar: vi.fn() })
  runtime.ctx.provide('uiWorkspace', { startSession: vi.fn() } as never)
  runtime.ctx.provide('uiConversation', { selectView: vi.fn() } as never)
  const remote = {
    $host: { home: '/home/u', hostname: 'test-host', isLoopback: true },
    session: {
      externalApps: vi.fn(async () => ({ ok: true, value: { platform: 'linux', apps: [], canReveal: false } })),
      fork: vi.fn(async () => ({ ok: true, value: { sessionId: 'child-1' } })),
    },
    files: {
      list: vi.fn(async () => ({ ok: true, value: { path: '/home/u', home: '/home/u', crumbs: [], entries: [], truncated: false } })),
      read: vi.fn(async (path: string) => ({ ok: true, value: { path, text: '', binary: false, size: 0 } })),
    },
    github: {
      status: vi.fn(async () => ({ ok: true, value: { configured: false, pageLimit: 100 } })),
      repository: vi.fn(async () => ({ ok: true, value: { owner: 'o', repo: 'r' } })),
      pullRequests: vi.fn(async () => ({ ok: true, value: { items: [], hasNext: false } })),
      linkedPullRequests: vi.fn(async () => ({ ok: true, value: { items: [], hasNext: false } })),
      pullRequestDetail: vi.fn(async () => ({
        ok: true,
        value: {
          number: 7, title: 'A PR', body: '', state: 'open', merged: false, draft: false,
          branch: 'feature', baseBranch: 'main', author: 'alice', url: '',
          files: [], checks: [], comments: [],
        },
      })),
      pullRequestAction: vi.fn(async () => ({ ok: true, value: { done: true, message: 'merged' } })),
    },
    browser: {
      state: vi.fn(async () => ({
        ok: true as const,
        value: { profile: 'default', url: null, status: 'closed' as const, titleSource: 'unknown' as const, source: 'user' as const },
      })),
      navigate: vi.fn(async () => ({ ok: true as const, value: {} })),
      close: vi.fn(async () => ({ ok: true as const, value: {} })),
    },
  }
  runtime.ctx.provide('remote', remote as never)
  runtime.ctx.provide('remote.session', remote.session as never)
  runtime.ctx.provide('remote.files', remote.files as never)
  runtime.ctx.provide('remote.github', remote.github as never)
  runtime.ctx.provide('remote.browser', remote.browser as never)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.register('common', { zh: commonZh, en: commonEn, ar: commonAr })
  if (options.locale === 'en') locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({
    'sidebar': { kind: 'single', scope: 'root' },
    'titlebar': { kind: 'single', scope: 'root' },
    'rightbar': { kind: 'single', scope: 'session' },
  })
  await runtime.mount({ inject: [...inject], apply })
  return { runtime, locale }
}

describe('sidebar shell snapshots', () => {
  it('renders the expanded column in the default locale (zh, no setLocale)', async () => {
    const { runtime } = await bench()
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    // The column owns only New Session; the brand lives in the titlebar.
    expect(slot.view.queryByRole('button', { name: '回到主页' })).toBeNull()
    expect(slot.view.getAllByRole('button', { name: '新建会话' })).toHaveLength(1)
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })

  it('renders the expanded column (capsule, empty holes)', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    expect(slot.view.queryByRole('button', { name: 'Go to home' })).toBeNull()
    expect(slot.view.getAllByRole('button', { name: 'New session' })).toHaveLength(1)
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })

  it('keeps the fold control and brand out of the column on every host', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    expect(slot.view.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    expect(slot.view.queryByRole('button', { name: 'Go to home' })).toBeNull()
    expect(slot.view.queryByText('Greeneek')).toBeNull()
    await runtime.dispose()
  })

  it('renders the collapsed rail after the crossfade settles, in place', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    const shell = slot.container.firstElementChild
    slot.update({ collapsed: true, width: 56 })
    // The wide-only label unmounts at the 150ms settle; the capsule remains a
    // New Session button. The fold toggle is in the titlebar, not here.
    await waitFor(() => {
      expect(slot.view.getAllByRole('button', { name: 'New session' })).toHaveLength(1)
    })
    expect(slot.view.queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    expect(slot.container).toMatchSnapshot()
    // Same tree position: the owner flip re-rendered the shell in place.
    expect(slot.container.firstElementChild).toBe(shell)
    await runtime.dispose()
  })

  it('a locale switch refreshes mounted copy without re-registration', async () => {
    const { runtime, locale } = await bench()
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    expect(slot.view.queryByRole('button', { name: '回到主页' })).toBeNull()
    expect(slot.view.getAllByRole('button', { name: '新建会话' })).toHaveLength(1)
    // Same fiber, same registration: setLocale alone re-renders the outlet.
    act(() => { locale.setLocale('en') })
    expect(slot.view.getAllByRole('button', { name: 'New session' })).toHaveLength(1)
    expect(slot.view.queryByRole('button', { name: '新建会话' })).toBeNull()
    await runtime.dispose()
  })
})
