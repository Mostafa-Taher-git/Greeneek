/**
 * ui-wave browser half: the two slot seats, the fleet dictionaries, the verbs
 * the inject face hands a surface, and the mirror teardown on fiber unload.
 */
import { Context } from '@greeneek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import { stubSettingsScope, TestRemote } from '@greeneek/gnk-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@greeneek/gnk-client-locale/client'
import type { WaveId, WaveMemberId, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { FleetInjected } from '../src/client/contract.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

const SESSION = 'lead-1' as SessionId
const CHILD = 'child-1' as SessionId
const WAVE = 'wave-1' as WaveId
const MEMBER = 'member-1' as WaveMemberId

/** One open wave, enough for the mirror to record a sample. */
const VIEW: WaveView = {
  waveId: WAVE,
  label: 'docs pass',
  parentSessionId: SESSION,
  closed: false,
  members: [{ memberId: MEMBER, provider: 'spawn', status: 'running', tokensUsed: 10 }],
}

/** The `waves` namespace, scripted per call. */
function wavesNamespace(): {
  list: ReturnType<typeof vi.fn>
  cancelAll: ReturnType<typeof vi.fn>
  cancelWave: ReturnType<typeof vi.fn>
  cancelMember: ReturnType<typeof vi.fn>
} {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, value: [VIEW] }),
    cancelAll: vi.fn().mockResolvedValue({ ok: true, value: { waveIds: [WAVE] } }),
    cancelWave: vi.fn().mockResolvedValue({ ok: true, value: { cancelled: true } }),
    cancelMember: vi.fn().mockResolvedValue({ ok: true, value: { cancelled: true } }),
  }
}

/** Boot the browser half over a slot tree declaring both seats this plugin fills. */
async function bench(waves = wavesNamespace()): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  waves: typeof waves
  openSubagent: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.details.fleet': { kind: 'single', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const openSubagent = vi.fn()
  ctx.provide('sessions', { openSubagent })
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  new TestRemote(ctx, { waves })
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, waves, openSubagent }
}

/** The inject face one seat's registration builds for this session. */
function injectedFor(ctx: Context, key: 'conversation.details.fleet' | 'conversation.input.left'): FleetInjected {
  const entry = ctx.slots.entries(key)[0]
  const factory = entry?.inject as ((sessionId: SessionId) => FleetInjected) | undefined
  if (factory === undefined) throw new Error(`no inject face registered under ${key}`)
  return factory(SESSION)
}

describe('ui-wave browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'remote', 'remote.waves'])
  })

  it('fills the node half without touching a service', () => {
    // The host entry exists so the plugin appears in the Loader; a throw here
    // would surface as a profile-boot failure, so calling it is the assertion.
    applyNode()
  })

  it('registers the Fleet body and the composer pill, and fiber teardown removes both', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('conversation.details.fleet')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.input.left').map(entry => entry.options.id)).toContain('army-fleet')
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.details.fleet')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('stop.all')).toBe(zh['stop.all'])
    ctx.locale.setLocale('en')
    expect(translate('stop.all')).toBe(en['stop.all'])

    await fiber.dispose()
    expect(translate('stop.all')).not.toBe(en['stop.all'])
  })

  it('gives a surface one mirror per session, sampled from the waves namespace', async () => {
    const { ctx, fiber, waves } = await bench()
    const panel = injectedFor(ctx, 'conversation.details.fleet')
    const pill = injectedFor(ctx, 'conversation.input.left')
    expect(panel.hooks.fleet).toBe(pill.hooks.fleet)
    expect(panel.hooks.fleet.getSnapshot()).toMatchObject({ loading: true, waveViews: [] })

    panel.refresh()
    await vi.waitFor(() => {
      expect(panel.hooks.fleet.getSnapshot().waveViews).toHaveLength(1)
    })
    expect(waves.list).toHaveBeenCalledWith(SESSION)
    expect(panel.hooks.fleet.getSnapshot()).toMatchObject({ stoppable: true, degraded: false })
    await fiber.dispose()
  })

  it('routes the stop verbs to their Remote endpoints', async () => {
    const { ctx, fiber, waves } = await bench()
    const panel = injectedFor(ctx, 'conversation.details.fleet')
    await expect(panel.stopWave(WAVE)).resolves.toEqual({ ok: true, value: { cancelled: true } })
    await expect(panel.stopMember(WAVE, MEMBER)).resolves.toEqual({ ok: true, value: { cancelled: true } })
    await expect(panel.stopAll()).resolves.toEqual({ ok: true, value: { waveIds: [WAVE] } })
    expect(waves.cancelWave).toHaveBeenCalledWith(WAVE)
    expect(waves.cancelMember).toHaveBeenCalledWith(WAVE, MEMBER)
    expect(waves.cancelAll).toHaveBeenCalledWith(SESSION)
    await fiber.dispose()
  })

  it('opens a member transcript as a one-shot child of this session', async () => {
    const { ctx, fiber, openSubagent } = await bench()
    injectedFor(ctx, 'conversation.input.left').openChild(CHILD)
    expect(openSubagent).toHaveBeenCalledWith({ parentSessionId: SESSION, childSessionId: CHILD, mode: 'one-shot' })
    await fiber.dispose()
  })

  it('stops sampling once the fiber unloads', async () => {
    const { ctx, fiber, waves } = await bench()
    const panel = injectedFor(ctx, 'conversation.details.fleet')
    panel.refresh()
    await vi.waitFor(() => {
      expect(waves.list).toHaveBeenCalled()
    })
    const samples = waves.list.mock.calls.length
    await fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(waves.list.mock.calls.length).toBe(samples)
  })
})
