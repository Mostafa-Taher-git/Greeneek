import { describe, expect, it } from 'vitest'
import { runDebate, type DebatePorts } from '../src/debate.ts'

/**
 * Scripted ports: every spawn/send/collect is canned, so these tests prove
 * round management, identity preservation, and verdict parsing without any
 * inference. Live roster wiring is covered separately.
 */
function scripted(script: Record<string, string[]>): { readonly ports: DebatePorts; readonly log: string[] } {
  const log: string[] = []
  const queues = new Map(Object.entries(script).map(([name, turns]) => [name, [...turns]]))
  const ports: DebatePorts = {
    spawn: (provider, name) => {
      log.push(`spawn ${name} via ${provider}`)
      return Promise.resolve()
    },
    send: (target, content) => {
      log.push(`send ${target}: ${content.split('\n')[0]}`)
      return Promise.resolve()
    },
    collect: (participant) => {
      const queue = queues.get(participant)
      const text = queue?.shift()
      if (text === undefined) return Promise.reject(new Error(`no canned turn for ${participant}`))
      log.push(`collect ${participant}`)
      return Promise.resolve(text)
    },
    dispose: (participant) => {
      log.push(`dispose ${participant}`)
      return Promise.resolve()
    },
  }
  return { ports, log }
}

describe('runDebate', () => {
  it('spawns every seat with the same topic, then runs the five phases and publishes a moderator synthesis', async () => {
    const { ports, log } = scripted({
      'alpha': [
        'alpha position: use A',
        'alpha objection: B ignores sign-off',
        'alpha rebuttal: A keeps sign-off',
        'alpha evidence: A cites migration log 12',
      ],
      'beta': [
        'beta position: use B',
        'beta objection: A omits rollback',
        'beta rebuttal: B owns rollback',
        'beta evidence: B cites rollback drill output',
      ],
      'chair': ['VERDICT: no-consensus\nCONSENSUS: no\nUNRESOLVED: sign-off order\nSynthesized: partial agreement'],
    })
    const result = await runDebate(ports, {
      topic: 'Which migration order?',
      participants: [{ provider: 'codex', name: 'alpha' }, { provider: 'claude-code', name: 'beta' }],
      moderator: { provider: 'greeneek', name: 'chair' },
      maxRounds: 2,
      signal: new AbortController().signal,
    })

    // All seats spawned before any collection (independent positions).
    expect(log.slice(0, 2)).toEqual(['spawn alpha via codex', 'spawn beta via claude-code'])
    // Position, cross-examination, rebuttal, evidence, and synthesis turns.
    expect(result.entries).toHaveLength(9)
    expect(result.entries.map(entry => entry.role)).toEqual([
      'position', 'position', 'objection', 'objection', 'rebuttal', 'rebuttal', 'evidence', 'evidence', 'synthesis',
    ])
    // Source identity preserved per turn.
    expect(result.entries[0]).toMatchObject({ participant: 'alpha', sourceHarness: 'codex', round: 0 })
    expect(result.entries[1]).toMatchObject({ participant: 'beta', sourceHarness: 'claude-code', round: 0 })
    expect(result.entries[6]).toMatchObject({ participant: 'alpha', sourceHarness: 'codex', role: 'evidence' })
    // The synthesis belongs to the dedicated moderator, never to participants[0].
    expect(result.moderator).toBe('chair')
    expect(result.moderatorHarness).toBe('greeneek')
    expect(result.entries[8]).toMatchObject({ participant: 'chair', sourceHarness: 'greeneek', role: 'synthesis' })
    expect(result.entries.some(entry => entry.participant === 'alpha-synthesizer')).toBe(false)
    // Verdict parsed from the moderator's structured lines.
    expect(result.verdictMode).toBe('no-consensus')
    expect(result.consensus).toBe(false)
    expect(result.unresolved).toEqual(['sign-off order'])
    expect(result.minorityEvidence).toEqual([])
    expect(result.synthesis).toContain('Synthesized:')
  })

  it('defaults to a dedicated moderator seat instead of the first participant', async () => {
    const { ports, log } = scripted({
      'solo': ['solo position', 'solo objection', 'solo evidence'],
      'moderator': ['VERDICT: consensus\nCONSENSUS: yes\nSynthesized: unanimous'],
    })
    const result = await runDebate(ports, {
      topic: 'Adopt C?',
      participants: [{ provider: 'spawn', name: 'solo' }],
      maxRounds: 1,
      signal: new AbortController().signal,
    })
    expect(result.moderator).toBe('moderator')
    expect(result.moderatorHarness).toBe('spawn')
    expect(result.entries.at(-1)).toMatchObject({ participant: 'moderator', sourceHarness: 'spawn', role: 'synthesis' })
    expect(log).toContain('spawn moderator via spawn')
    expect(result.verdictMode).toBe('consensus')
    expect(result.consensus).toBe(true)
    expect(result.unresolved).toEqual([])
  })

  it('keeps minority evidence beside a majority verdict so a majority cannot certify a false claim', async () => {
    const { ports } = scripted({
      'alpha': ['alpha position', 'alpha objection', 'alpha rebuttal', 'alpha evidence: log line 12'],
      'beta': ['beta position', 'beta objection', 'beta rebuttal', 'beta evidence: test output contradicts A'],
      'moderator': [[
        'VERDICT: majority\nCONSENSUS: no\nMINORITY-EVIDENCE: beta test output contradicts A (src/migrate.ts:44)',
        'Synthesized: majority agrees on A but beta evidences otherwise',
      ].join('\n')],
    })
    const result = await runDebate(ports, {
      topic: 'Adopt C?',
      participants: [{ provider: 'codex', name: 'alpha' }, { provider: 'claude-code', name: 'beta' }],
      maxRounds: 2,
      signal: new AbortController().signal,
    })
    expect(result.verdictMode).toBe('majority')
    // A majority verdict is not consensus and never certifies its claim.
    expect(result.consensus).toBe(false)
    expect(result.minorityEvidence).toEqual(['beta test output contradicts A (src/migrate.ts:44)'])
    expect(result.synthesis).toContain('MINORITY-EVIDENCE:')
  })

  it('lets the strongest evidence win as evidence-based even when it is a minority position', async () => {
    const { ports } = scripted({
      'alpha': ['alpha position', 'alpha objection', 'alpha evidence: no run output'],
      'beta': ['beta position', 'beta objection', 'beta evidence: failing gate output at ci.log:88'],
      'moderator': [[
        'VERDICT: evidence-based\nCONSENSUS: no\nMINORITY-EVIDENCE: failing gate output at ci.log:88',
        'Synthesized: beta evidence wins over the majority position',
      ].join('\n')],
    })
    const result = await runDebate(ports, {
      topic: 'Ship the migration?',
      participants: [{ provider: 'codex', name: 'alpha' }, { provider: 'claude-code', name: 'beta' }],
      maxRounds: 1,
      signal: new AbortController().signal,
    })
    expect(result.verdictMode).toBe('evidence-based')
    expect(result.consensus).toBe(false)
    expect(result.minorityEvidence).toEqual(['failing gate output at ci.log:88'])
  })

  it('falls back to the legacy CONSENSUS line when the synthesis carries no VERDICT line', async () => {
    const { ports } = scripted({
      'solo': ['solo position', 'solo evidence'],
      'moderator': ['CONSENSUS: yes\nSynthesized: unanimous'],
    })
    const result = await runDebate(ports, {
      topic: 'Adopt C?',
      participants: [{ provider: 'spawn', name: 'solo' }],
      maxRounds: 0,
      signal: new AbortController().signal,
    })
    expect(result.entries.map(entry => entry.role)).toEqual(['position', 'synthesis'])
    expect(result.verdictMode).toBe('consensus')
    expect(result.consensus).toBe(true)
  })

  it('reads a verdict a moderator wrapped in markdown, and drops placeholder reports', async () => {
    const { ports } = scripted({
      'solo': ['solo position', 'solo evidence'],
      'moderator': [
        '**VERDICT: consensus**\n\n**CONSENSUS: yes**\n\n**UNRESOLVED:** *(none — no disagreements were raised)*\n\n**MINORITY-EVIDENCE:** *(none — no minority position carried supporting evidence)*\n\n**Synthesis:** both seats agree.',
      ],
    })
    const result = await runDebate(ports, {
      topic: 'Adopt C?',
      participants: [{ provider: 'spawn', name: 'solo' }],
      maxRounds: 0,
      signal: new AbortController().signal,
    })
    expect(result.verdictMode).toBe('consensus')
    expect(result.consensus).toBe(true)
    expect(result.unresolved).toEqual([])
    expect(result.minorityEvidence).toEqual([])
  })

  it('refuses an empty seat list and a negative round count', async () => {
    const { ports } = scripted({})
    await expect(runDebate(ports, {
      topic: 'X', participants: [], signal: new AbortController().signal,
    })).rejects.toThrow('at least one participant')
    await expect(runDebate(ports, {
      topic: 'X',
      participants: [{ provider: 'spawn' }],
      maxRounds: -1,
      signal: new AbortController().signal,
    })).rejects.toThrow('non-negative integer')
  })

  it('refuses a moderator name that collides with a participant', async () => {
    const { ports } = scripted({})
    await expect(runDebate(ports, {
      topic: 'X',
      participants: [{ provider: 'spawn', name: 'alpha' }],
      moderator: { provider: 'fork', name: 'alpha' },
      signal: new AbortController().signal,
    })).rejects.toThrow('moderator name must differ')
  })

  it('rejects a cancelled debate before spawning', async () => {
    const { ports } = scripted({ solo: ['never'] })
    const controller = new AbortController()
    controller.abort()
    await expect(runDebate(ports, {
      topic: 'X',
      participants: [{ provider: 'spawn', name: 'solo' }],
      signal: controller.signal,
    })).rejects.toThrow('cancelled')
  })
})
