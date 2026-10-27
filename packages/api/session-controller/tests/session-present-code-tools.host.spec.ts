/** Session opt-in of the lazy `both` code-tools presentation. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import AgentRegistry from '@greeneek/gnk-agent'
import type { Agent, AgentFactory, AgentSetup } from '@greeneek/gnk-agent'
import { ToolPresentationLockedError } from '@greeneek/gnk-tools'
import SessionStore, { SessionId } from '@greeneek/gnk-session'
import type { Session } from '@greeneek/gnk-session'
import { createScope } from '@greeneek/gnk-scope'
import { describe, expect, it } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

interface HarnessStubs {
  /** Compose a `codeRuntime` provider into every agent scope. */
  readonly codeRuntime?: boolean
}

async function harness(stubs: HarnessStubs = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gnk-session-present-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)

  /** Every presentation declaration made on any agent scope, in call order. */
  const declarations: string[] = []
  const disposals = new Map<SessionId, () => Promise<void>>()

  const own = async (session: Session, setup?: AgentSetup) => {
    const agent = stubAgent(session)
    // Per-agent service stubs live on a minted scope, like the production
    // agent composition: `extend` is a view over the shared store, so a
    // second `provide` through a bare extension would collide with the
    // first agent's registration at the test root.
    const scope = createScope(ctx, agent)
    const agentCtx = scope.ctx.extend({ agent })
    let declared = false
    agentCtx.provide('tools', {
      presentAs: (mode: 'native' | 'ptc' | 'both') => {
        if (declared) throw new ToolPresentationLockedError(mode, mode)
        declared = true
        declarations.push(mode)
        return () => {}
      },
    } as never)
    if (stubs.codeRuntime === true) agentCtx.provide('codeRuntime', {} as never)
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

  it('refuses a second opt-in with the presentation lock', async () => {
    const { remote, declarations } = await harness({ codeRuntime: true })
    await remote.create({ sessionId: SessionId('s2') })
    await remote.presentCodeTools({ sessionId: SessionId('s2') })

    const response = await remote.presentCodeTools({ sessionId: SessionId('s2') })

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'tool/presentation-locked', details: { sessionId: 's2' } },
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
})
