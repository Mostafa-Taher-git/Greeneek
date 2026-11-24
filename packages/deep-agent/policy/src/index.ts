/**
 * Deep-agent authorization policy, adapted from the reference prototype's
 * `admission.ts` and `policy.ts`. Who may originate work is configured per
 * Source; the Policy never maps a person across Sources.
 */
import { key } from '@greeneek/gnk-deep-agent-core'
import type {
  ActorRef, AdmissionCell, GateResult, Mandate, Policy as PolicyPort, Thread, Ticket, Trigger,
} from '@greeneek/gnk-deep-agent-core'

/** Admission values a cell may grant. */
export type Admission = 'explicit' | 'inferred' | 'ignore'

/** Three cells of a receiving scope's admission row. */
export const ADMISSION_DEFAULTS = {
  listedUnaddressed: 'inferred',
  unlistedAddressed: 'ignore',
  unlistedUnaddressed: 'ignore',
} as const satisfies Record<AdmissionCell, Admission>

/** Per-sender admission values for the three cells of a receiving scope. */
export interface AdmissionRow {
  readonly listedUnaddressed?: 'inferred' | 'ignore'
  readonly unlistedAddressed?: 'explicit' | 'inferred' | 'ignore'
  readonly unlistedUnaddressed?: 'inferred' | 'ignore'
}

/** Mode governing whether inferred candidates are admitted. */
export type AcceptMode = 'off' | 'observe' | 'auto'

/** A person or bot allowed by a Source, matched by id rather than display name. */
export interface AllowedActor { readonly id: string; readonly name?: string }
/** One authorization rule the Router cites when accepting an inferred candidate. */
export interface Rule {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly instruction: string
}

/** Per-Source allow lists and admission overrides. */
export interface PolicySource {
  readonly allowed: readonly AllowedActor[]
  readonly bots?: readonly AllowedActor[]
  readonly admission?: Readonly<Record<string, AdmissionRow>>
}

/** User settings from which the versioned Policy port is built. */
export interface PolicySettings {
  readonly rules: readonly Rule[]
  readonly sources: Readonly<Record<string, PolicySource>>
  readonly mode: AcceptMode
  readonly paused?: boolean
  readonly evalTimeoutMs?: number
}

/**
 * Name comparison is case-insensitive and ignores a trailing bot marker.
 * @param left - first actor id or name.
 * @param right - second actor id or name.
 * @returns true when both normalize to the same name.
 */
export function sameName(left: string, right: string): boolean {
  const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s*\[bot\]$/, '')
  return normalize(left) === normalize(right)
}

/** Revision tag included in the policy version hash. */
export const POLICY_REVISION = 'mandate-v3'
/**
 * Version hash over the authorization-relevant settings only.
 * @param settings - Policy settings to hash.
 * @returns the deterministic version string.
 */
export function policyVersion(settings: PolicySettings): string {
  return key(POLICY_REVISION, JSON.stringify({
    rules: settings.rules,
    mode: settings.mode,
    sources: settings.sources,
  }))
}

/**
 * Whether inferred candidates are admitted by the current mode and matched rules.
 * @param settings - Policy settings carrying mode and rule definitions.
 * @param rules - identifiers of rules matched for a candidate.
 * @returns true only in auto mode with at least one enabled matched rule.
 */
export function admitsInferred(settings: PolicySettings, rules: readonly string[]): boolean {
  return settings.mode === 'auto' && rules.length > 0
    && rules.every(id => settings.rules.some(rule => rule.enabled && rule.id === id))
}

/** A settled direction requires implementation intent, a known target, and no open design decision. */
export interface AdmissionDirection {
  readonly implementation_requested: boolean
  readonly target_basis: 'specified' | 'existing-standard' | 'undetermined'
  readonly requires_design_decision: boolean
  readonly evidence: string
}
/**
 * Whether a parsed value is a settled direction that can authorize work.
 * @param value - untrusted parsed value to test.
 * @returns true when the value has implementation intent and no open design decision.
 */
export function directionAllowed(value: unknown): value is AdmissionDirection {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AdmissionDirection>
  return candidate.implementation_requested === true
    && candidate.target_basis !== 'undetermined'
    && candidate.requires_design_decision !== true
}

/** Whether a thread already has tickets of its own, excluding context-only subscriptions. */
function hasOwnTickets(thread: Thread, tickets: readonly Ticket[]): boolean {
  return thread.subscriptions.some((id) => {
    const ticket = tickets.find(item => item.id === id)
    return ticket !== undefined && ticket.ended === undefined && (ticket.follows ?? []).length === 0
  })
}

/** Trigger, Thread, and open Tickets presented to the admission gate. */
export interface GateInput {
  readonly trigger: Trigger
  readonly thread: Thread
  readonly tickets: readonly Ticket[]
}

/**
 * Build the versioned policy port consumed by the Engine.
 * @param settings - user settings to compile into the port.
 * @returns a PolicyPort with gate, revalidation, and admission checks.
 */
export function buildPolicy(settings: PolicySettings): PolicyPort {
  const version = policyVersion(settings)
  const sourcePart = (source: string): PolicySource => settings.sources[source] ?? { allowed: [] }
  const listed = (actor: ActorRef): boolean => sourcePart(actor.source).allowed.some(entry => sameName(entry.id, actor.id))
  const listedBot = (actor: ActorRef): boolean => sourcePart(actor.source).bots?.some(entry => sameName(entry.id, actor.id)) ?? false

  const cellIdFor = (trigger: Trigger): AdmissionCell => {
    if (listed(trigger.actor)) return 'listedUnaddressed'
    return trigger.addressed === undefined ? 'unlistedUnaddressed' : 'unlistedAddressed'
  }

  const admissionValue = (trigger: Trigger): Admission => {
    const row = sourcePart(trigger.source).admission?.[trigger.actor.id] ?? {}
    const cell = cellIdFor(trigger)
    return row[cell] ?? ADMISSION_DEFAULTS[cell]
  }

  const gate = (trigger: Trigger, thread: Thread, tickets: readonly Ticket[]): GateResult => {
    if (!trigger.human) {
      if (listedBot(trigger.actor) && trigger.addressed !== undefined) {
        return { admissible: true, strength: 'inferred', basis: { via: 'bot', addressed: trigger.addressed, observation: { mode: settings.mode } } }
      }
      return { admissible: false, reason: listedBot(trigger.actor) ? 'bot_not_addressed' : 'not_human' }
    }
    const allowed = listed(trigger.actor)
    if (allowed && trigger.addressed !== undefined) {
      return { admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: trigger.addressed, sender: trigger.actor.id } }
    }
    if (hasOwnTickets(thread, tickets)) {
      return {
        admissible: true,
        strength: allowed ? 'explicit' : 'inferred',
        basis: { via: 'followup', ...(allowed ? { authority: 'listed' } : {}) },
      }
    }
    const value = admissionValue(trigger)
    const cell = cellIdFor(trigger)
    if (value === 'explicit') {
      return { admissible: true, strength: 'explicit', basis: { via: 'admission', cell, ...(trigger.addressed === undefined ? {} : { addressed: trigger.addressed }) } }
    }
    if (value === 'inferred') {
      return { admissible: true, strength: 'inferred', basis: { via: 'admission', cell, observation: { mode: settings.mode } } }
    }
    return { admissible: false, reason: allowed ? 'admission_ignored' : 'not_a_member' }
  }

  const revalidate = (mandate: Mandate, trigger: Trigger): boolean => {
    if (sourcePart(mandate.actor.source).allowed.length === 0) return false
    switch (mandate.basis.via) {
      case 'addressed':
        return listed(trigger.actor)
      case 'followup':
        return mandate.strength !== 'explicit' || listed(trigger.actor)
      case 'admission': {
        const value = admissionValue(trigger)
        if (mandate.strength === 'explicit' && value !== 'explicit') return false
        return value !== 'ignore'
      }
      case 'bot':
        return listedBot(trigger.actor)
      case 'listed':
        return listed(trigger.actor)
    }
  }

  return {
    version,
    paused: settings.paused ?? false,
    evalTimeoutMs: settings.evalTimeoutMs ?? 120_000,
    gate,
    revalidate,
    admitsInferred: rules => admitsInferred(settings, rules),
  }
}
