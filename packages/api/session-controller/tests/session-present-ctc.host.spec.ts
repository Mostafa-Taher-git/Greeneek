/** Session opt-in of the lazy `both` code-tools presentation. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import AgentRegistry from '@greeneek/gnk-agent'
import type { Agent, AgentFactory, AgentSetup, AgentStatus } from '@greeneek/gnk-agent'
import { CodeRuntime } from '@greeneek/gnk-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@greeneek/gnk-code-runtime'
import SystemPrompt from '@greeneek/gnk-system-prompt'
import ToolRuntime, { RUN_CODE_NAME, ToolPresentationLockedError, defineTool } from '@greeneek/gnk-tools'
import type { ToolPresentationMode } from '@greeneek/gnk-tools'
import SessionStore, { SessionId } from '@greeneek/gnk-session'
import type { Session } from '@greeneek/gnk-session'
import { createScope } from '@greeneek/gnk-scope'
import type { Scope } from '@greeneek/gnk-scope'
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

describe('session.presentCtc opt-in', () => {
  it('applies the opt-in once to the live agent scope and logs the declaration', async () => {
    const { ctx, remote, declarations } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s1') })

    const result = await remote.presentCtc({ sessionId: SessionId('s1') })

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
    await remote.presentCtc({ sessionId: SessionId('s2'), enabled: true })

    const repeat = await remote.presentCtc({ sessionId: SessionId('s2'), enabled: true })

    expect(repeat).toMatchObject({ ok: true, value: { presentAs: 'both' } })
    expect(declarations).toEqual(['both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s2'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(1)
  })

  it('withdraws the opt-in and lets the same session declare it again', async () => {
    const { ctx, remote, declarations, withdrawals } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s5') })
    await remote.presentCtc({ sessionId: SessionId('s5'), enabled: true })

    const off = await remote.presentCtc({ sessionId: SessionId('s5'), enabled: false })
    expect(off).toMatchObject({ ok: true, value: { presentAs: 'native' } })
    expect(withdrawals).toEqual(['both'])
    using observed = await ctx.sessionQuery.observeSession(SessionId('s5'))
    expect((observed.projections?.values as Record<string, unknown>).presentAs).toBe('native')

    const on = await remote.presentCtc({ sessionId: SessionId('s5'), enabled: true })
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

    const off = await remote.presentCtc({ sessionId: SessionId('s6'), enabled: false })

    expect(off).toMatchObject({ ok: true, value: { presentAs: 'native' } })
    expect(withdrawals).toEqual([])
    const log = await ctx.sessionQuery.readSession(SessionId('s6'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(0)
  })

  it('refuses to reverse a presentation its composition declared', async () => {
    const { remote, declarations } = await harness({ codeRuntime: true, compositionDeclares: true })
    await remote.create({ sessionId: SessionId('s7') })

    const response = await remote.presentCtc({ sessionId: SessionId('s7'), enabled: true })

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'tool/presentation-locked', details: { sessionId: 's7' } },
    })
    expect(declarations).toEqual(['both'])
  })

  it('requires a composed code runtime', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s3') })

    const response = await remote.presentCtc({ sessionId: SessionId('s3') })

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'tool/code-runtime-required' },
    })
  })

  it('re-declares the opt-in silently when re-adopting the Session', async () => {
    const { ctx, remote, declarations, disposeAgent } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s4') })
    await remote.presentCtc({ sessionId: SessionId('s4') })
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
    await remote.presentCtc({ sessionId: SessionId('s8'), enabled: true })

    const refused = await remote.presentCtc({ sessionId: SessionId('s8'), enabled: false })

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

    const refused = await remote.presentCtc({ sessionId: SessionId('s9'), enabled: true })

    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('unreachable')
    expect(refused.error.code).toBe('gateway/internal')
    expect(refused.error.message).toContain('log offline')
    expect(declarations).toEqual(['both'])
    expect(withdrawals).toEqual(['both'])
    const log = await ctx.sessionQuery.readSession(SessionId('s9'))
    expect(log.events.filter(event => event.type === 'tool/present-as')).toHaveLength(0)

    allowAppend()
    const retry = await remote.presentCtc({ sessionId: SessionId('s9'), enabled: true })
    expect(retry).toMatchObject({ ok: true, value: { presentAs: 'both' } })
  })

  it('restores the declaration when a withdrawal cannot be recorded', async () => {
    const { ctx, remote, declarations, withdrawals, refuseAppend } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s10') })
    await remote.presentCtc({ sessionId: SessionId('s10'), enabled: true })
    // A thrown non-Error still reaches the refusal text through `String`.
    refuseAppend('log offline')

    const refused = await remote.presentCtc({ sessionId: SessionId('s10'), enabled: false })

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

    const refused = await remote.presentCtc({ sessionId: SessionId('s11'), enabled: true })

    expect(refused).toMatchObject({ ok: false, error: { code: 'gateway/internal', message: 'registry exploded' } })
    expect(declarations).toEqual([])
  })
})

/** A runtime that never runs anything: presentation never dispatches. */
class StubRegistryRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'stub'

  run(_request: CodeRunRequest): Promise<CodeRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

/**
 * A real registry beside the Session Controller: the toggle drives the actual
 * `ToolRuntime` and `SystemPrompt`, so each state is read back as the model
 * would receive it. Unlike the stub harness above, this factory mounts no
 * fake `tools` provider — the agent scope inherits the global registry.
 */
async function harnessRealRegistry() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gnk-session-present-real-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(StubRegistryRuntime)
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echo tool.',
    parameters: { value: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: args => Promise.resolve(args.value),
  }))

  const disposals = new Map<SessionId, () => Promise<void>>()
  const own = async (rawSession: Session, setup?: AgentSetup) => {
    const agent = stubAgent(rawSession)
    // Mint the scope under an injecting fiber, the way `gnk-tools` tests do:
    // the scope's parent must carry `tools`/`systemPrompt` in its store for
    // `agent.ctx.tools` property access to resolve.
    let scope!: Scope
    const fiber = ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent)
    }, { inject: ['tools', 'systemPrompt'] }))
    await fiber.await()
    const agentCtx = scope.ctx.extend({ agent })
    ;(agent as { ctx?: Context }).ctx = agentCtx
    await setup?.(agentCtx)
    const unregister = ctx.agents.register(agent)
    const dispose = async (): Promise<void> => {
      unregister()
      await scope.dispose()
    }
    disposals.set(rawSession.id, dispose)
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
    disposeAgent: async (sessionId: SessionId) => { await disposals.get(sessionId)?.() },
  }
}

async function assembled(ctx: Context, sessionId: SessionId) {
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`expected a live agent for "${sessionId}"`)
  return await ctx.systemPrompt.assemble({ scope: agent })
}

describe('session.presentCtc against the real registry', () => {
  it('carries the run_code schema and the SDK section through the toggle cycle', async () => {
    const { ctx, remote } = await harnessRealRegistry()
    await remote.create({ sessionId: SessionId('s-registry') })

    const initial = await assembled(ctx, SessionId('s-registry'))
    expect(initial.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(initial.sections.some(section => section.name === 'tools:sdk')).toBe(false)

    const enableResult = await remote.presentCtc({ sessionId: SessionId('s-registry'), enabled: true })
    expect(enableResult).toMatchObject({ ok: true })
    const on = await assembled(ctx, SessionId('s-registry'))
    expect(on.tools.map(tool => tool.name).sort()).toEqual(['echo', RUN_CODE_NAME])
    const runCode = on.tools.find(tool => tool.name === RUN_CODE_NAME)!
    expect(runCode.description).toContain('Execute a TypeScript program')
    expect(runCode.parameters).toMatchObject({
      properties: { code: expect.anything() as unknown, description: expect.anything() as unknown },
    })
    const sdkOn = on.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    expect(sdkOn).toContain('declare const tools')
    expect(sdkOn).toContain('echo')

    await remote.presentCtc({ sessionId: SessionId('s-registry'), enabled: false })
    const off = await assembled(ctx, SessionId('s-registry'))
    expect(off.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(off.sections.some(section => section.name === 'tools:sdk')).toBe(false)

    await remote.presentCtc({ sessionId: SessionId('s-registry'), enabled: true })
    const again = await assembled(ctx, SessionId('s-registry'))
    expect(again.tools.map(tool => tool.name).sort()).toEqual(['echo', RUN_CODE_NAME])
    expect(again.sections.find(section => section.name === 'tools:sdk')?.text ?? '').toContain('declare const tools')
  })

  it('replays the recorded toggle cycle on resume', async () => {
    const { ctx, remote, disposeAgent } = await harnessRealRegistry()
    await remote.create({ sessionId: SessionId('s-replay') })
    await remote.presentCtc({ sessionId: SessionId('s-replay'), enabled: true })
    await remote.presentCtc({ sessionId: SessionId('s-replay'), enabled: false })
    await remote.presentCtc({ sessionId: SessionId('s-replay'), enabled: true })

    const log = await ctx.sessionQuery.readSession(SessionId('s-replay'))
    expect(log.events.filter(event => event.type === 'tool/present-as')
      .map(event => (event.data as { to: string }).to)).toEqual(['both', 'native', 'both'])
    using observed = await ctx.sessionQuery.observeSession(SessionId('s-replay'))
    expect((observed.projections?.values as Record<string, unknown>).presentAs).toBe('both')

    await disposeAgent(SessionId('s-replay'))
    // Re-adopting the stored session resumes it and silently re-declares the
    // recorded presentation, appending no new event.
    await remote.create({ sessionId: SessionId('s-replay') })
    const replayed = await assembled(ctx, SessionId('s-replay'))
    expect(replayed.tools.map(tool => tool.name).sort()).toEqual(['echo', RUN_CODE_NAME])
    expect(replayed.sections.find(section => section.name === 'tools:sdk')?.text ?? '').toContain('declare const tools')
    const after = await ctx.sessionQuery.readSession(SessionId('s-replay'))
    expect(after.events.filter(event => event.type === 'tool/present-as')).toHaveLength(3)

    // A session that ends on `native` resumes without the transport.
    await remote.create({ sessionId: SessionId('s-replay-native') })
    await remote.presentCtc({ sessionId: SessionId('s-replay-native'), enabled: true })
    await remote.presentCtc({ sessionId: SessionId('s-replay-native'), enabled: false })
    await disposeAgent(SessionId('s-replay-native'))
    await remote.create({ sessionId: SessionId('s-replay-native') })
    const replayedNative = await assembled(ctx, SessionId('s-replay-native'))
    expect(replayedNative.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(replayedNative.sections.some(section => section.name === 'tools:sdk')).toBe(false)
    using nativeObserved = await ctx.sessionQuery.observeSession(SessionId('s-replay-native'))
    expect((nativeObserved.projections?.values as Record<string, unknown>).presentAs).toBe('native')
  })
})
