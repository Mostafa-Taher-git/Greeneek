/** Sidebar shell slot registration and its Session/layout callbacks. */
import { Context } from '@greeneek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { apply, inject } from '@greeneek/gnk-client-ui-sidebar/client'
import type { SidebarRootInjected, SurfacePanelInjected, TitlebarInjected } from '@greeneek/gnk-client-ui-sidebar/client'
import { apply as hostApply } from '../src/index.ts'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = {
    toggleSidebar: vi.fn(),
    showConversation: vi.fn(),
    openTerminalDrawer: vi.fn(),
    openSettings: vi.fn(),
    openDashboard: vi.fn(),
  }
  const uiWorkspace = { startSession: vi.fn() }
  const uiConversation = { selectView: vi.fn() }
  const remote = {
    $host: { home: '/home/u', hostname: 'test-host', isLoopback: true },
    session: { externalApps: vi.fn(async () => ({ ok: true, value: { platform: 'linux', apps: [], canReveal: false } })) },
    files: {
      list: vi.fn(async () => ({ ok: true, value: { path: '/home/u', home: '/home/u', crumbs: [], entries: [], truncated: false } })),
      read: vi.fn(async (path: string) => ({ ok: true, value: { path, text: '', binary: false, size: 0 } })),
    },
  }
  ctx.provide('layout', layout)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('uiConversation', uiConversation as never)
  ctx.provide('remote', remote as never)
  ctx.provide('remote.session', remote.session as never)
  ctx.provide('remote.files', remote.files as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      {
        name: 'root',
        children: {
          'sidebar': { kind: 'single', scope: 'root' },
          'titlebar': { kind: 'single', scope: 'root' },
          'rightbar': { kind: 'single', scope: 'session' },
        },
      } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, uiWorkspace, uiConversation, remote }
}

describe('ui-sidebar apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'layout', 'uiWorkspace', 'uiConversation', 'locale', 'remote', 'remote.session', 'remote.files',
    ])
  })

  it('registers the shell and declares its child seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.brand.mark')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.brand.name')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('sidebar')
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'toggleSidebar'])
    // Both arms delegate to the Workspace UI's shared New Session action.
    injected.startSession('workspace' as never)
    expect(b.layout.showConversation).toHaveBeenCalledOnce()
    expect(b.uiWorkspace.startSession).toHaveBeenCalledWith('workspace')
    injected.startSession()
    expect(b.layout.showConversation).toHaveBeenCalledTimes(2)
    expect(b.uiWorkspace.startSession).toHaveBeenLastCalledWith(undefined)
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
    expect(b.slots.entries('titlebar')).toHaveLength(1)
    expect(b.slots.entries('titlebar')[0]!.locale).toBe('sidebar')
    // The titlebar's one navigation verb yields to the conversation, then
    // selects the Session's Chat view.
    const titlebar = b.slots.entries('titlebar')[0]!.inject as () => TitlebarInjected
    titlebar().openChat('s1' as never)
    expect(b.layout.showConversation).toHaveBeenCalledTimes(3)
    expect(b.uiConversation.selectView).toHaveBeenCalledWith('s1', 'chat')
    titlebar().toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledTimes(2)
    titlebar().startSession()
    expect(b.layout.showConversation).toHaveBeenCalledTimes(4)
    expect(b.uiWorkspace.startSession).toHaveBeenCalledTimes(3)

    expect(b.slots.entries('rightbar')).toHaveLength(1)
    expect(b.slots.entries('rightbar')[0]!.locale).toBe('sidebar')
    // Every launcher row delegates to a destination this app really has.
    const surfaces = b.slots.entries('rightbar')[0]!.inject as () => SurfacePanelInjected
    surfaces().openTerminal()
    expect(b.layout.openTerminalDrawer).toHaveBeenCalledOnce()
    surfaces().openTrajectory('s1' as never)
    expect(b.layout.showConversation).toHaveBeenCalledTimes(5)
    expect(b.uiConversation.selectView).toHaveBeenCalledWith('s1', 'trajectory')
    surfaces().openChat('s1' as never)
    expect(b.layout.showConversation).toHaveBeenCalledTimes(6)
    expect(b.uiConversation.selectView).toHaveBeenCalledWith('s1', 'chat')
    surfaces().openSettings()
    expect(b.layout.openSettings).toHaveBeenCalledOnce()
    surfaces().openDashboard()
    expect(b.layout.openDashboard).toHaveBeenCalledOnce()
  })

  it('fails when no live owner declared the sidebar slot', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('rightbar')).toHaveLength(0)
    expect(b.slots.spec('sidebar.brand.mark')).toBeUndefined()
    expect(b.slots.spec('sidebar.brand.name')).toBeUndefined()
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
  })
})
