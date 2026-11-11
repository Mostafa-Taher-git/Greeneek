/**
 * Greeneek starts without `GREENEEK_API_KEY`: the variable names one provider's
 * credential, not a product requirement. A first-run composition with no
 * provider configured boots, session list/catalog and other non-AI surfaces
 * work, and prompting reports the provider-specific `session/model-unavailable`
 * remedy instead of a Greeneek-only gate.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import AgentRegistry from '@greeneek/gnk-agent'
import type { Agent } from '@greeneek/gnk-agent'
import LlmRuntime from '@greeneek/gnk-llm'
import SessionStore from '@greeneek/gnk-session'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'
import { createSessionTestRemote } from './test-remote.ts'

let nextRequestId = 1
function promptRequest(
  payload: Omit<SessionPromptRequest, 'requestId'>,
): SessionPromptRequest {
  return {
    ...payload,
    requestId: `no-key-${String(nextRequestId++)}` as SessionRequestId,
  }
}

describe('Greeneek without GREENEEK_API_KEY', () => {
  const hadKey = Object.hasOwn(process.env, 'GREENEEK_API_KEY')
  const previousKey = process.env['GREENEEK_API_KEY']

  afterEach(() => {
    if (hadKey) process.env['GREENEEK_API_KEY'] = previousKey
    else Reflect.deleteProperty(process.env, 'GREENEEK_API_KEY')
  })

  it('boots, serves non-AI session surfaces, and reports a provider-specific missing-model error', async () => {
    Reflect.deleteProperty(process.env, 'GREENEEK_API_KEY')
    expect(process.env['GREENEEK_API_KEY']).toBeUndefined()

    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(AgentRegistry)
      // No Greeneek adapter mounted and no default model: the shipped first-run
      // posture. Boot must still succeed without GREENEEK_API_KEY.
      const session = ctx.sessions.create()
      const sessionId = session.id
      const agent = {
        id: session.id,
        session,
        options: {},
        status: 'running',
        ctx,
        inbox: { nextTurn: [], nextStep: [] },
      } as unknown as Agent
      ctx.agents.register(agent)
      const remote = createSessionTestRemote(ctx, {
        // First-run: no provider key has activated any route.
        defaultModelSelection: () => undefined as never,
        cwd: '/tmp',
      })

      // Non-AI features work without a provider key.
      const listed = await remote.list({})
      expect(listed.ok).toBe(true)
      const catalog = await remote.modelCatalog()
      expect(catalog.ok).toBe(true)

      // Prompting without a provider reports the provider-specific remedy.
      const refused = await remote.prompt(promptRequest({
        sessionId,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: 'hi' }],
      }))
      expect(refused).toMatchObject({
        ok: false,
        error: {
          code: 'session/model-unavailable',
          message: 'no model is configured; add a provider API key in Settings → Models, then select a model',
          details: {},
        },
      })
      // The remedy names Settings, not GREENEEK_API_KEY alone.
      expect((refused as { error: { message: string } }).error.message)
        .not.toContain('GREENEEK_API_KEY')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
