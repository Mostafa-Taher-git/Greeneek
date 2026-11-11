/**
 * Regression gate for debate seat collection. A debate reply belongs to the
 * turn that answers the prompt just queued: an inherited fork prefix or a
 * reply that settled before collection began must never be returned as the
 * current turn, and a seat that reuses a roster name must fail before any new
 * seat exists.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentLoop from '@greeneek/gnk-agent-loop'
import { mountAgentLoopTestDependencies } from '@greeneek/gnk-agent-loop-testkit'
import type { Agent } from '@greeneek/gnk-agent'
import { createUserMessage } from '@greeneek/gnk-llm'
import type { GenerateOptions, StreamChunk } from '@greeneek/gnk-llm'
import { SessionId } from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import SubagentService from '@greeneek/gnk-subagent'
import * as SubagentFork from '@greeneek/gnk-subagent-fork-in-process'
import * as SubagentSpawn from '@greeneek/gnk-subagent-spawn-in-process'
import SessionQueryEngine from '@greeneek/gnk-session-query'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../src/index.ts'

/** Session query implementation whose search faces are outside these tests. */
class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

const SIGNAL = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Join every user-role text block so one script can answer each seat by the
 * prompt in its conversation; runtime-context reminders follow the real prompt.
 * @param options - the model request the loop built.
 * @returns all user message text blocks joined by newlines.
 */
function conversationText(options: GenerateOptions): string {
  const parts: string[] = []
  for (const message of options.messages) {
    if (message.role !== 'user') continue
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/**
 * A stream that spends its whole output budget on reasoning: the turn ends
 * `max-tokens` with an assistant message that carries no text block.
 * @returns the reasoning-only chunks.
 */
function reasoningOnlyResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'thinking only' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking only' } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ]
}

/**
 * Mount the real Team service over an in-process mock model and one Lead.
 * @param script - per-call replies, usually one function that reads the prompt.
 * @returns the test context and the Lead agent.
 */async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: { readonly maxMembers?: number } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'gnk-debate-collection-'))
  roots.push(dir)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: dir })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, options.maxMembers === undefined ? {} : { maxMembers: options.maxMembers })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('debate-lead'), { provider: 'mock', model: 'mock' }, { cwd: dir })
  return { ctx, lead, dir }
}

describe('debate seat collection', () => {
  it('returns the moderator turn, never the inherited parent prefix', async () => {
    const reply = (options: GenerateOptions): StreamChunk[] => {
      const prompt = conversationText(options)
      if (prompt.includes('You are the debate moderator')) {
        return textResponse('VERDICT: consensus\nCONSENSUS: yes\nSynthesized: moderator-only-synthesis')
      }
      if (prompt.includes('parent prefix turn')) return textResponse('PARENT-PREFIX-ONLY')
      return textResponse('alpha position: keep turns sequential')
    }
    const { ctx, lead } = await setup(Array.from({ length: 6 }, () => reply))

    // One completed Lead turn makes the fork moderator inherit a real prefix:
    // an assistant message that predates the debate entirely.
    lead.followup(createUserMessage({ content: [{ type: 'text', text: 'parent prefix turn' }], source: { kind: 'user' } }))
    await lead.whenIdle()

    const result = await ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns within one round run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }],
      moderator: { provider: 'fork', name: 'moderator' },
      maxRounds: 0,
      signal: SIGNAL,
    })

    expect(result.entries.map(entry => entry.role)).toEqual(['position', 'synthesis'])
    expect(result.entries[0]).toMatchObject({ participant: 'alpha', sourceHarness: 'spawn' })
    expect(result.entries[1]).toMatchObject({ participant: 'moderator', sourceHarness: 'fork', role: 'synthesis' })
    expect(result.synthesis).toContain('moderator-only-synthesis')
    expect(result.synthesis).not.toContain('PARENT-PREFIX-ONLY')
    expect(result.verdictMode).toBe('consensus')
    expect(result.failures).toEqual([])
  })

  it('fails the moderator by name when its own turn has no text, never returning the prefix', async () => {
    const reply = (options: GenerateOptions): StreamChunk[] => {
      const prompt = conversationText(options)
      if (prompt.includes('You are the debate moderator')) return reasoningOnlyResponse()
      if (prompt.includes('parent prefix turn')) return textResponse('PARENT-PREFIX-ONLY')
      return textResponse('alpha position: keep turns sequential')
    }
    const { ctx, lead } = await setup(Array.from({ length: 6 }, () => reply))
    lead.followup(createUserMessage({ content: [{ type: 'text', text: 'parent prefix turn' }], source: { kind: 'user' } }))
    await lead.whenIdle()

    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns within one round run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }],
      moderator: { provider: 'fork', name: 'moderator' },
      maxRounds: 0,
      signal: SIGNAL,
    })).rejects.toThrow(/produced no text in turn \d+ \(reached the output-token limit\)/)
  })

  it('refuses a debate the caller may not run, with no seat created', async () => {
    // A hanging seat keeps its Agent registered, so the teammate is a live
    // caller the debate must refuse.
    const { ctx, lead } = await setup(['hang'])
    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'alpha',
      description: 'a teammate may not conduct',
      prompt: [{ type: 'text', text: 'hold the seat' }],
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })
    let teammate: Agent | undefined
    for (let attempt = 0; attempt < 50 && teammate === undefined; attempt += 1) {
      teammate = ctx.agents.get(spawned.member.id)
      if (teammate === undefined) await new Promise(resolve => setTimeout(resolve, 20))
    }
    if (teammate === undefined) throw new Error('the teammate agent never registered')
    const membersBefore = ctx.agentTeams.listMembers(lead).length

    await expect(ctx.agentTeams.conductDebate(teammate, {
      topic: 'Should participant turns run concurrently?',
      participants: [{ provider: 'spawn', name: 'beta' }],
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })

    expect(ctx.agentTeams.listMembers(lead).length).toBe(membersBefore)
    teammate.cancel({ kind: 'user' })
  })

  it('refuses an empty seat list, a negative round count, and repeated speaking names', async () => {
    const { ctx, lead } = await setup([textResponse('unused')])

    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns run concurrently?',
      participants: [],
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }],
      maxRounds: -1,
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }, { provider: 'fork', name: 'alpha' }],
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }],
      moderator: { provider: 'fork', name: 'alpha' },
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
  })

  it('runs a multi-round debate across every phase with one reply per seat turn', async () => {
    const reply = (options: GenerateOptions): StreamChunk[] => {
      const prompt = conversationText(options)
      if (prompt.includes('You are the debate moderator')) {
        return textResponse('VERDICT: majority\nCONSENSUS: no\nUNRESOLVED: sign-off order\nSynthesized: partial agreement')
      }
      if (prompt.includes('ROUND 1 — OBJECTION')) return textResponse('objection: the other seat omits rollback')
      if (prompt.includes('ROUND 2 — EVIDENCE')) return textResponse('evidence: the rollback drill output')
      return textResponse('position: keep the round sequential')
    }
    const { ctx, lead } = await setup(Array.from({ length: 40 }, () => reply))

    const result = await ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns within one round run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }, { provider: 'fork', name: 'beta' }],
      moderator: { provider: 'spawn', name: 'moderator' },
      maxRounds: 1,
      signal: SIGNAL,
    })

    expect(result.entries.map(entry => entry.role)).toEqual([
      'position', 'position', 'objection', 'objection', 'evidence', 'evidence', 'synthesis',
    ])
    expect(result.entries.map(entry => entry.participant)).toEqual([
      'alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta', 'moderator',
    ])
    expect(result.entries.map(entry => entry.sourceHarness)).toEqual([
      'spawn', 'fork', 'spawn', 'fork', 'spawn', 'fork', 'spawn',
    ])
    expect(result.failures).toEqual([])
    expect(result.verdictMode).toBe('majority')
    expect(result.unresolved).toEqual(['sign-off order'])
  })

  it('refuses a reused roster name before spawning any debate seat', async () => {
    const { ctx, lead } = await setup([textResponse('held seat')])
    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'alpha',
      description: 'already owns this name',
      prompt: [{ type: 'text', text: 'hold the seat' }],
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })
    await lead.whenIdle()
    const membersBefore = ctx.agentTeams.listMembers(lead).length

    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns run concurrently?',
      participants: [{ provider: 'spawn', name: 'alpha' }],
      maxRounds: 0,
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })

    expect(ctx.agentTeams.listMembers(lead).length).toBe(membersBefore)
  })

  it('refuses a debate that would exceed the roster cap before spawning any seat', async () => {
    const { ctx, lead } = await setup([textResponse('held seat')], { maxMembers: 2 })
    await ctx.agentTeams.spawnTeammate(lead, {
      name: 'holder',
      description: 'occupies one of two seats',
      prompt: [{ type: 'text', text: 'hold the seat' }],
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })
    await lead.whenIdle()
    const membersBefore = ctx.agentTeams.listMembers(lead).length

    // One participant plus the moderator needs two more seats; only one is left.
    await expect(ctx.agentTeams.conductDebate(lead, {
      topic: 'Should participant turns run concurrently?',
      participants: [{ provider: 'spawn', name: 'debater' }],
      maxRounds: 0,
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })

    expect(ctx.agentTeams.listMembers(lead).length).toBe(membersBefore)
  })
})
