/** Session opt-in of the lazy `both` code-tools presentation. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import AgentRegistry from '@greeneek/gnk-agent'
import type { Agent, AgentFactory, AgentSetup, AgentStatus } from '@greeneek/gnk-agent'
import { ToolPresentationLockedError } from '@greeneek/gnk-tools'
import type { ToolPresentationMode } from '@greeneek/gnk-tools'
import SessionStore, { SessionId } from '@greeneek/gnk-session'
import type { Session } from '@greeneek/gnk-session'
import { createScope } from '@greeneek/gnk-scope'
import { describe, expect, it } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

function stubAgent(session: Session, status: AgentStatus = 'idle'): Agent {
  return { id: session.id, session, status } as unknown as Agent
}

interface HarnessStubs {
  /** Compose a `codeRuntime` provider into every agent scope. */
  readonly codeRuntime?: boolean
  /**
   * Let the composition itself declare the presentation, the way a preset row
   * does. That declaration is outside the user's registry, so the chip must
   * meet the presentation lock instead of reversing a preset's choice.
   */
  readonly compositionDeclares?: boolean
  /** Lifecycle status the composed Agent reports; a running Agent defers withdrawal. */
  readonly status?: AgentStatus
  /** Thrown by `tools.presentAs` instead of declaring, for a failure the lock is not. */
  readonly presentError?: unknown
}

/**
 * Wrap one Session so a `tool/present-as` append throws what `refusal` returns,
 * while every other event type still appends to the wrapped Session.
 */
function appendSwitch(target: Session, refusal: () => unknown): Session {
  // The generic `append` signature cannot be reached with a runtime event-type
  // string, so the wrapper reads it through the two-argument form it forwards.
  const plain = target as unknown as { append: (event: string, data: unknown) => unknown }
  const append = (type: string, data: unknown): unknown => {
    if (type === 'tool/present-as') {
      const error = refusal()
      if (error !== undefined) throw error
    }
    return plain.append(type, data)
  }
  return new Proxy(target, {
    get: (receiver, property): unknown =>
      property === 'append' ? append : Reflect.get(receiver, property),
  })
}

async function harness(stubs: HarnessStubs = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gnk-session-present-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)

  /** Every presentation declaration made on any agent scope, in call order. */
  const declarations: string[] = []
  /** Every withdrawal of a declaration, so a toggle cycle is observable. */
  const withdrawals: string[] = []
  const disposals = new Map<SessionId, () => Promise<void>>()
  /** What a `tool/present-as` append throws, or undefined while writes succeed. */
  let appendRefusal: unknown

  const own = async (rawSession: Session, setup?: AgentSetup) => {
    const session = appendSwitch(rawSession, () => appendRefusal)
    const agent = stubAgent(session, stubs.status)
    // Per-agent service stubs live on a minted scope, like the production
    // agent composition: `extend` is a view over the shared store, so a
    // second `provide` through a bare extension would collide with the
    // first agent's registration at the test root.
    const scope = createScope(ctx, agent)
    const agentCtx = scope.ctx.extend({ agent })
    let declared: ToolPresentationMode | undefined
    agentCtx.provide('tools', {
      presentAs: (mode: ToolPresentationMode) => {
        if (stubs.presentError !== undefined) throw stubs.presentError
        // The real registry refuses a second declaration while the scope holds
        // one and accepts it again once the earlier disposer has run.
        if (declared !== undefined) throw new ToolPresentationLockedError(declared, mode)
        declared = mode
        declarations.push(mode)
        return () => {
          if (declared === undefined) return
          withdrawals.push(declared)
          declared = undefined
        }
      },
    } as never)
    if (stubs.codeRuntime === true) agentCtx.provide('codeRuntime', {} as never)
    if (stubs.compositionDeclares === true) {
      // A preset composition declares on the same scope and the Session
      // Controller never learns that disposer, so the chip cannot reverse it.
      agentCtx.tools.presentAs('both')
    }
    ;(agent as { ctx?: Context }).ctx = agentCtx
    await setup?.(agentCtx)
    const unregister = ctx.agents.register(agent)
    const dispose = async (): Promise<void> => {
      unregister()
      await scope.dispose()
    }
    disposals.set(session.id, dispose)
    return { agent, dispose }
  }

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      return own(session, options.setup)
    },
    async resume(_ownerCtx, options) {
      // The harness dispose only unregisters, so the adopted session remains
      // in the store for re-composition exactly like a mid-life re-adopt.
      const session = ctx.sessions.get(options.resumeSessionId)
      if (session === undefined) {
        throw new Error(`test harness resumed session "${options.resumeSessionId}" that the store no longer holds`)
      }
      return own(session, options.setup)
    },
  }
  ctx.agents.setFactory(factory)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return {
    ctx,
    remote,
    declarations,
    withdrawals,
    /** Make the next `tool/present-as` append throw `error`. */
    refuseAppend: (error: unknown): void => { appendRefusal = error },
    /** Let `tool/present-as` appends through again. */
    allowAppend: (): void => { appendRefusal = undefined },
    disposeAgent: async (sessionId: SessionId) => { await disposals.get(sessionId)?.() },
  }
}

describe('session.presentCodeTools opt-in', () => {
  it('applies the opt-in once to the live agent scope and logs the declaration', async () => {
    const { ctx, remote, declarations } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s1') })

    const result = await remote.presentCodeTools({ sessionId: SessionId('s1') })

    expect(result).toMatchObject({ ok: true, value: { presentAs: 'both' } })
    expect(declarations).toEqual(['both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s1'))
    const declared = log.events.filter(event => event.type === 'tool/present-as')
    expect(declared).toHaveLength(1)
    expect(declared[0]).toMatchObject({ data: { to: 'both' } })
    using observed = await ctx.sessionQuery.observeSession(SessionId('s1'))
    expect((observed.projections?.values as Record<string, unknown>).presentAs).toBe('both')
  })

  it('treats a repeated opt-in as the state it already left', async () => {
    const { ctx, remote, declarations } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s2') })
    await remote.presentCodeTools({ sessionId: SessionId('s2'), enabled: true })

    const repeat = await remote.presentCodeTools({ sessionId: SessionId('s2'), enabled: true })

    expect(repeat).toMatchObject({ ok: true, value: { presentAs: 'both' } })
    expect(declarations).toEqual(['both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s2'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(1)
  })

  it('withdraws the opt-in and lets the same session declare it again', async () => {
    const { ctx, remote, declarations, withdrawals } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s5') })
    await remote.presentCodeTools({ sessionId: SessionId('s5'), enabled: true })

    const off = await remote.presentCodeTools({ sessionId: SessionId('s5'), enabled: false })
    expect(off).toMatchObject({ ok: true, value: { presentAs: 'native' } })
    expect(withdrawals).toEqual(['both'])
    using observed = await ctx.sessionQuery.observeSession(SessionId('s5'))
    expect((observed.projections?.values as Record<string, unknown>).presentAs).toBe('native')

    const on = await remote.presentCodeTools({ sessionId: SessionId('s5'), enabled: true })
    expect(on).toMatchObject({ ok: true, value: { presentAs: 'both' } })
    // The withdrawal released the scope, so the re-declaration is a fresh one
    // rather than the lock refusal a second presentAs on a live scope gives.
    expect(declarations).toEqual(['both', 'both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s5'))
    expect(log.events.filter(event => event.type === 'tool/present-as')
      .map(event => (event.data as { to: string }).to)).toEqual(['both', 'native', 'both'])
  })

  it('reports native without logging when nothing was ever declared', async () => {
    const { ctx, remote, withdrawals } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s6') })

    const off = await remote.presentCodeTools({ sessionId: SessionId('s6'), enabled: false })

    expect(off).toMatchObject({ ok: true, value: { presentAs: 'native' } })
    expect(withdrawals).toEqual([])
    const log = await ctx.sessionQuery.readSession(SessionId('s6'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(0)
  })

  it('refuses to reverse a presentation its composition declared', async () => {
    const { remote, declarations } = await harness({ codeRuntime: true, compositionDeclares: true })
    await remote.create({ sessionId: SessionId('s7') })

    const response = await remote.presentCodeTools({ sessionId: SessionId('s7'), enabled: true })

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'tool/presentation-locked', details: { sessionId: 's7' } },
    })
    expect(declarations).toEqual(['both'])
  })

  it('requires a composed code runtime', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s3') })

    const response = await remote.presentCodeTools({ sessionId: SessionId('s3') })

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'tool/code-runtime-required' },
    })
  })

  it('re-declares the opt-in silently when re-adopting the Session', async () => {
    const { ctx, remote, declarations, disposeAgent } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s4') })
    await remote.presentCodeTools({ sessionId: SessionId('s4') })
    await disposeAgent(SessionId('s4'))
    expect(declarations).toEqual(['both'])

    const adopted = await remote.create({ sessionId: SessionId('s4') })
    expect(adopted).toMatchObject({ ok: true })
    expect(declarations).toEqual(['both', 'both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s4'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(1)
  })

  it('refuses a withdrawal while the Agent runs and keeps the live declaration', async () => {
    const { remote, declarations, withdrawals } = await harness({ codeRuntime: true, status: 'running' })
    await remote.create({ sessionId: SessionId('s8') })
    await remote.presentCodeTools({ sessionId: SessionId('s8'), enabled: true })

    const refused = await remote.presentCodeTools({ sessionId: SessionId('s8'), enabled: false })

    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'tool/presentation-busy', details: { sessionId: 's8' } },
    })
    expect(declarations).toEqual(['both'])
    expect(withdrawals).toEqual([])
  })

  it('leaves no declaration behind when the opt-in cannot be recorded', async () => {
    const { ctx, remote, declarations, withdrawals, refuseAppend, allowAppend } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s9') })
    refuseAppend(new Error('log offline'))

    const refused = await remote.presentCodeTools({ sessionId: SessionId('s9'), enabled: true })

    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('unreachable')
    expect(refused.error.code).toBe('gateway/internal')
    expect(refused.error.message).toContain('log offline')
    expect(declarations).toEqual(['both'])
    expect(withdrawals).toEqual(['both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s9'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(0)

    allowAppend()
    const retry = await remote.presentCodeTools({ sessionId: SessionId('s9'), enabled: true })
    expect(retry).toMatchObject({ ok: true, value: { presentAs: 'both' } })
  })

  it('restores the declaration when a withdrawal cannot be recorded', async () => {
    const { ctx, remote, declarations, withdrawals, refuseAppend } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s10') })
    await remote.presentCodeTools({ sessionId: SessionId('s10'), enabled: true })
    // A thrown non-Error still reaches the refusal text through `String`.
    refuseAppend('log offline')

    const refused = await remote.presentCodeTools({ sessionId: SessionId('s10'), enabled: false })

    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('unreachable')
    expect(refused.error.code).toBe('gateway/internal')
    expect(refused.error.message).toContain('log offline')
    expect(declarations).toEqual(['both', 'both'])
    expect(withdrawals).toEqual(['both'])
    using observed = await ctx.sessionQuery.observeSession(SessionId('s10'))
    expect((observed.projections?.values as Record<string, unknown>).presentAs).toBe('both')
  })

  it('propagates a tools failure that is not the presentation lock', async () => {
    const { remote, declarations } = await harness({
      codeRuntime: true,
      presentError: new Error('registry exploded'),
    })
    await remote.create({ sessionId: SessionId('s11') })

    const refused = await remote.presentCodeTools({ sessionId: SessionId('s11'), enabled: true })

    expect(refused).toMatchObject({ ok: false, error: { code: 'gateway/internal', message: 'registry exploded' } })
    expect(declarations).toEqual([])
  })
})
