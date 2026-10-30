import { Context, Service } from '@greeneek/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@greeneek/gnk-session/types'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import type { FleetFavorite, FleetProviderAvailability, FleetSettings, TeamMemberView as TeamRosterMember, TeamTaskId } from '@greeneek/gnk-agent-team/client'
import type {} from '@greeneek/gnk-agent-team/remote'
import { RemoteError } from '@greeneek/gnk-client-test-runtime'
import type { TypertRemoteContribution } from '@greeneek/gnk-typert-protocol'
import { TeamAction, type TeamActionInjected } from '../src/client/TeamAction.tsx'
import { FleetSettingsSection, type FleetSettingsInjected } from '../src/client/FleetSettingsSection.tsx'
import { inject, mountAgentTeamUi } from '../src/client/mount.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION = 'team-session' as SessionId
const CHILD = 'team-child' as SessionId
const TASK_ID = 'task-1' as TeamTaskId
const REMOTE: TypertRemoteContribution = {
  package: '@greeneek/gnk-agent-team',
  descriptors: [],
}

async function bench(options: {
  addressed?: boolean
  conflict?: boolean
  registrationFailure?: boolean
  remoteFailure?: 'view' | 'update'
  refreshGate?: Promise<void>
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const answer = <T>(method: string, value: T) => (...args: unknown[]) => {
    calls.push({ method, args })
    return Promise.resolve({ ok: true as const, value })
  }
  const task = {
    id: 'task-1',
    revision: 1, subject: 'Task', description: 'Description', status: 'pending' as const,
    blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
  }
  class RemoteService extends Service {
    readonly disposeMount = vi.fn(() => Promise.resolve())
    readonly mount = vi.fn((_contribution: unknown) => Promise.resolve(this.disposeMount))

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $mount(contribution: unknown): Promise<() => Promise<void>> {
      return this.mount(contribution)
    }
  }
  const remote = new RemoteService(ctx)
  const failure = {
    ok: false as const,
    error: new RemoteError('gateway/internal', 'offline', {}),
  }
  const view = {
    members: [{
      id: SESSION, name: 'lead', role: 'lead' as const, status: 'idle' as const, diagnostics: [],
    }], tasks: [task],
  }
  ctx.provide('remote.agentTeams', {
    view: (...args: unknown[]) => {
      calls.push({ method: 'agentTeams/view', args })
      return Promise.resolve(options.remoteFailure === 'view'
        ? failure
        : { ok: true as const, value: view })
    },
    fleetAvailability: answer('agentTeams/fleetAvailability', [
      { name: 'spawn', state: 'ready', continuable: true },
    ] satisfies FleetProviderAvailability[]),
    launchFleetFavorite: answer('agentTeams/launchFleetFavorite', {
      ok: true,
      value: { members: [] },
    }),
    createTask: answer('agentTeams/createTask', task),
    updateTask: (...args: unknown[]) => {
      calls.push({ method: 'agentTeams/updateTask', args })
      if (options.remoteFailure === 'update') return Promise.resolve(failure)
      return Promise.resolve(options.conflict
        ? {
          ok: true as const,
          value: {
            ok: false as const,
            error: {
              code: 'team-task-conflict' as const,
              message: 'stale',
            },
          },
        }
        : { ok: true as const, value: { ok: true as const, value: { ...task, revision: 2 } } })
    },
  })
  const navigation: unknown[] = []
  let current = options.addressed === true ? CHILD : SESSION
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current }) },
    binding: (id: SessionId) => options.addressed === true && id === CHILD
      ? { session: { getSnapshot: () => ({
        subagent: {
          address: {
            parentSessionId: SESSION,
            childSessionId: CHILD,
            mode: 'continuable' as const,
          },
        },
      }) } }
      : undefined,
    refreshSubagents: (id: SessionId) => {
      navigation.push(['refresh', id])
      return options.refreshGate ?? Promise.resolve()
    },
    openSubagent: (address: unknown) => { navigation.push(['open', address]) },
  })
  let fleetValue: FleetSettings = { favorites: [] }
  const fleetListeners = new Set<() => void>()
  // The real scope returns a stable snapshot reference until the next change;
  // mirror that so a derived-object getSnapshot regression surfaces here.
  let fleetScopeSnapshot = {
    status: 'ready' as const,
    value: fleetValue,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host' as const,
  }
  ctx.provide('settingsScope', {
    bind: () => ({
      getSnapshot: () => fleetScopeSnapshot,
      subscribe: (listener: () => void) => {
        fleetListeners.add(listener)
        return () => { fleetListeners.delete(listener) }
      },
      set: async (field: string, value: unknown) => {
        fleetValue = { ...fleetValue, [field]: value as FleetFavorite[] }
        fleetScopeSnapshot = { ...fleetScopeSnapshot, value: fleetValue, revision: fleetScopeSnapshot.revision + 1 }
        for (const listener of fleetListeners) listener()
      },
      unset: async () => undefined,
      mutate: async () => undefined,
    }),
  })
  ctx.provide('conversation', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const collapseHeader = ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  if (options.registrationFailure === true) {
    vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot registration failed') })
  }
  const fiber = options.registrationFailure === true
    ? ctx.plugin({ apply() {} })
    : ctx.plugin({ inject: [...inject], apply: clientCtx => mountAgentTeamUi(clientCtx, REMOTE) })
  const activation: Promise<unknown> = options.registrationFailure === true
    ? mountAgentTeamUi(ctx, REMOTE).catch((error: unknown) => error)
    : fiber.await()
  if (options.registrationFailure !== true) {
    await activation
  } else {
    await fiber.await()
  }
  const entry = () => ctx.slots.entries('conversation.session.header.actions')
    .find(candidate => candidate.component === TeamAction)
  const fleetEntry = () => ctx.slots.entries('settings.section')
    .find(candidate => candidate.component === FleetSettingsSection)
  return {
    ctx,
    fiber,
    activation,
    calls,
    navigation,
    remote,
    entry,
    fleetEntry,
    collapseHeader,
    select: (sessionId: SessionId) => { current = sessionId },
  }
}

describe('ui-team browser plugin', () => {
  it('bridges fleet availability, favorites, and launch through the settings section', async () => {
    const b = await bench({ addressed: true })
    const fleet = b.fleetEntry()!.inject!() as unknown as FleetSettingsInjected
    expect((b.fleetEntry()!.options as { label?: () => string }).label?.()).toBe('Fleet settings')

    expect(fleet.getSnapshot()).toMatchObject({ status: 'ready', writable: true })
    // A late bound getSnapshot must be referentially stable between changes or
    // useSyncExternalStore loops; and must change after a write.
    const beforeSave = fleet.getSnapshot()
    expect(fleet.getSnapshot()).toBe(beforeSave)
    expect((await fleet.loadAvailability()).ok).toBe(true)
    expect(b.calls).toContainEqual({ method: 'agentTeams/fleetAvailability', args: [] })
    const favorite = {
      id: 'review', name: 'Review', members: [{ name: 'worker', description: 'w', prompt: 'go', provider: 'spawn' }],
    }
    await fleet.save([favorite])
    expect(fleet.getSnapshot()).not.toBe(beforeSave)
    expect(fleet.getSnapshot().value?.favorites).toEqual([favorite])
    const listeners: number[] = []
    const unsubscribe = fleet.subscribe(() => listeners.push(1))
    await fleet.save([])
    unsubscribe()
    expect(listeners).toHaveLength(1)

    b.select(CHILD)
    expect(fleet.canLaunch()).toBe(true)
    expect((await fleet.launch('review')).ok).toBe(true)
    expect(b.calls).toContainEqual({
      method: 'agentTeams/launchFleetFavorite',
      args: [SESSION, 'review', true],
    })

    b.select(undefined as never)
    expect(fleet.canLaunch()).toBe(false)
    await expect(fleet.launch('review')).rejects.toThrow('Open a session before launching a fleet.')
  })

  it('registers one disposable header action with RPC-backed task operations', async () => {
    const b = await bench()
    expect(inject).toEqual(['sessions', 'remote', 'slots', 'locale', 'settingsScope'])
    expect(b.entry()).toMatchObject({
      options: { id: 'agent-team', order: 20 },
      locale: 'agent-team',
    })
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.mount).toHaveBeenCalledWith(REMOTE)
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    expect((await actions.load(SESSION)).ok).toBe(true)
    expect((await actions.createTask(SESSION, {
      subject: 'Task', description: 'Description', blockedBy: [], writeScopes: [],
    })).ok).toBe(true)
    expect((await actions.updateTask(SESSION, {
      taskId: TASK_ID, expectedRevision: 1, action: 'complete',
    })).ok).toBe(true)
    expect((await actions.updateTask(SESSION, {
      taskId: TASK_ID, expectedRevision: 2, action: 'reassign', owner: 'worker',
    })).ok).toBe(true)
    expect(b.calls.map(call => call.method)).toEqual([
      'agentTeams/view', 'agentTeams/createTask', 'agentTeams/updateTask', 'agentTeams/updateTask',
    ])
    expect(b.calls.at(-1)?.args[1]).toMatchObject({ owner: 'worker' })

    await actions.openTeammate(SESSION, {
      id: SESSION,
      name: 'lead',
      role: 'lead',
      status: 'idle',
      diagnostics: [],
    })
    expect(b.navigation).toEqual([])

    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('unmounts the Remote contribution when later Client registration fails', async () => {
    const b = await bench({ registrationFailure: true })
    await expect(b.activation).resolves.toMatchObject({ message: 'slot registration failed' })
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('returns the generated task business result without a Client transport wrapper', async () => {
    const b = await bench({ conflict: true })
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    await expect(actions.updateTask(SESSION, {
      taskId: TASK_ID, expectedRevision: 1, action: 'delete',
    })).resolves.toEqual({
      ok: true,
      value: {
        ok: false,
        error: { code: 'team-task-conflict', message: 'stale' },
      },
    })
  })

  it('returns Remote carrier failures unchanged', async () => {
    const view = await bench({ remoteFailure: 'view' })
    const viewActions = (view.entry()!.inject as unknown as () => TeamActionInjected)()
    await expect(viewActions.load(SESSION)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal', message: 'offline' },
    })

    const update = await bench({ remoteFailure: 'update' })
    const updateActions = (update.entry()!.inject as unknown as () => TeamActionInjected)()
    await expect(updateActions.updateTask(SESSION, {
      taskId: TASK_ID, expectedRevision: 1, action: 'delete',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal', message: 'offline' },
    })
  })

  it('refreshes the descriptor catalog before opening a continuable teammate address', async () => {
    const b = await bench()
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    const member: TeamRosterMember = {
      id: CHILD,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      diagnostics: [],
    }
    await actions.openTeammate(SESSION, member)
    expect(b.navigation).toEqual([
      ['refresh', SESSION],
      ['open', {
        parentSessionId: SESSION,
        childSessionId: CHILD,
        mode: 'continuable',
      }],
    ])
  })

  it('routes Team actions from an addressed teammate conversation back through its Lead', async () => {
    const b = await bench({ addressed: true })
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    await actions.load(CHILD)
    await actions.openTeammate(CHILD, {
      id: CHILD,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      diagnostics: [],
    })
    expect(b.calls[0]).toEqual({ method: 'agentTeams/view', args: [SESSION] })
    expect(b.navigation).toEqual([
      ['refresh', SESSION],
      ['open', {
        parentSessionId: SESSION,
        childSessionId: CHILD,
        mode: 'continuable',
      }],
    ])
  })

  it('does not open a teammate after navigation switches during catalog refresh', async () => {
    const refresh = Promise.withResolvers<undefined>()
    const b = await bench({ refreshGate: refresh.promise })
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    const opening = actions.openTeammate(SESSION, {
      id: CHILD,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      diagnostics: [],
    })
    expect(b.navigation).toEqual([['refresh', SESSION]])
    b.select('other-session' as SessionId)
    refresh.resolve(undefined)
    await opening
    expect(b.navigation).toEqual([['refresh', SESSION]])
  })

  it('re-registers after the conversation header slot is collapsed and declared again', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    b.collapseHeader()
    expect(b.entry()).toBeUndefined()
    b.ctx.slots.register({
      name: 'root',
      children: {
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await Promise.resolve()
    expect(b.entry()).toBeDefined()
  })

  it('keeps the node half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
