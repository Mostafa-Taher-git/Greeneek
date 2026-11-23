import { describe, expect, it } from 'vitest'
import { ADMISSION_DEFAULTS, buildPolicy, directionAllowed, policyVersion, sameName } from '../src/index.ts'
import type { PolicySettings, Rule } from '../src/index.ts'
import type { Thread, Trigger } from '@greeneek/gnk-deep-agent-core'

const rules: readonly Rule[] = [
  { id: 'copy', name: 'Copy fixes', enabled: true, instruction: 'Fix wording' },
  { id: 'visual', name: 'Visual fixes', enabled: false, instruction: 'Fix spacing' },
]

const settings = (overrides: Partial<PolicySettings> = {}): PolicySettings => ({
  rules,
  mode: 'observe',
  sources: {
    github: {
      allowed: [{ id: 'alice' }],
      bots: [{ id: 'ci-bot' }],
      admission: { bob: { unlistedAddressed: 'inferred' } },
    },
  },
  ...overrides,
})

const thread: Thread = {
  key: 'github:7', ref: { source: 'github', id: '7' }, createdAt: '2026-01-01T00:00:00.000Z',
  subscriptions: [], correlated: [], pending: [], meta: {},
}

const trigger = (overrides: Partial<Trigger> = {}): Trigger => ({
  id: 't1', source: 'github', threads: [{ source: 'github', id: '7' }],
  actor: { source: 'github', id: 'bob' }, human: true, addressed: 'mention',
  at: '2026-01-01T00:00:00.000Z', text: 'please fix', meta: {}, ...overrides,
})

describe('admission defaults', () => {
  it('matches the reference defaults', () => {
    expect(ADMISSION_DEFAULTS).toEqual({
      listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore',
    })
  })
})

describe('name comparison', () => {
  it('ignores case and a bot marker', () => {
    expect(sameName('Alice', 'alice')).toBe(true)
    expect(sameName('ci-bot[bot]', 'CI-BOT')).toBe(true)
    expect(sameName('alice', 'bob')).toBe(false)
  })
})

describe('version', () => {
  it('changes only with authorization-relevant settings', () => {
    const original = settings()
    expect(policyVersion(original)).toBe(policyVersion(settings()))
    expect(policyVersion(original)).not.toBe(policyVersion(settings({ mode: 'auto' })))
    expect(policyVersion(original)).not.toBe(policyVersion(settings({
      rules: [...rules, { id: 'new', name: 'New', enabled: true, instruction: 'x' }],
    })))
  })
})

describe('gate', () => {
  it('admits a listed addressed actor as explicit', () => {
    const result = buildPolicy(settings()).gate(trigger({ actor: { source: 'github', id: 'alice' } }), thread, [])
    expect(result).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'addressed' } })
  })

  it('uses the admission cell for an unlisted addressed actor', () => {
    const result = buildPolicy(settings()).gate(trigger(), thread, [])
    expect(result).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'admission', cell: 'unlistedAddressed' } })
  })

  it('refuses an unlisted unaddressed actor by default', () => {
    const unaddressed: Trigger = { ...trigger(), text: 'please fix' }
    delete (unaddressed as { addressed?: string }).addressed
    const result = buildPolicy(settings()).gate(unaddressed, thread, [])
    expect(result).toEqual({ admissible: false, reason: 'not_a_member' })
  })

  it('admits a listed bot only as inferred when addressed', () => {
    const policy = buildPolicy(settings())
    expect(policy.gate(trigger({ human: false, actor: { source: 'github', id: 'ci-bot' } }), thread, []))
      .toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'bot' } })
    const bot: Trigger = { ...trigger(), human: false, actor: { source: 'github', id: 'ci-bot' } }
    delete (bot as { addressed?: string }).addressed
    expect(policy.gate(bot, thread, [])).toEqual({ admissible: false, reason: 'bot_not_addressed' })
  })

  it('never treats inferred work as accepted outside auto mode', () => {
    expect(buildPolicy(settings()).admitsInferred(['copy'])).toBe(false)
    expect(buildPolicy(settings({ mode: 'auto' })).admitsInferred(['copy'])).toBe(true)
    expect(buildPolicy(settings({ mode: 'auto' })).admitsInferred(['disabled-rule'])).toBe(false)
  })
})

describe('mandate revalidation', () => {
  it('withdraws a mandate when the sender is no longer allowed', () => {
    const policy = buildPolicy(settings())
    const mandate = {
      strength: 'explicit' as const, policyVersion: policy.version,
      basis: { via: 'addressed' as const, addressed: 'mention' as const },
      actor: { source: 'github', id: 'alice' }, scope: 'github:7',
    }
    expect(policy.revalidate(mandate, trigger({ actor: { source: 'github', id: 'alice' } }))).toBe(true)
    expect(policy.revalidate(mandate, trigger({ actor: { source: 'github', id: 'mallory' } }))).toBe(false)
  })
})

describe('assessment direction', () => {
  it('requires intent, a settled target and no open design decision', () => {
    expect(directionAllowed({
      implementation_requested: true, target_basis: 'specified',
      requires_design_decision: false, evidence: 'requested',
    })).toBe(true)
    expect(directionAllowed({
      implementation_requested: true, target_basis: 'undetermined',
      requires_design_decision: false, evidence: 'vague',
    })).toBe(false)
    expect(directionAllowed(null)).toBe(false)
  })
})
