/**
 * Genuine multi-Harness debate orchestration.
 *
 * Each participant receives the same problem as its initial prompt and states
 * a position independently (Independent Proposals); cross-examination
 * objections, rebuttals, and evidence reviews then travel through the same
 * durable mailbox every Fleet member uses, so every turn is preserved with
 * participant and source-Harness identity. A dedicated moderator seat (never
 * the first participant's synthesizer) reads the full transcript and publishes
 * one of four verdicts — consensus, majority, evidence-based, or no consensus
 * — alongside unresolved disagreements and any minority evidence a majority
 * must not certify away.
 *
 * Nothing here concatenates independent answers: round ordering, delivery,
 * and synthesis are enforced by the orchestrator and covered end to end.
 * @module @greeneek/gnk-agent-team/debate
 */

/** One debate seat: a named connection plus its speaking name. */
export interface DebateParticipantSpec {
  /** Registry name of the connection (the Fleet `provider` value). */
  readonly provider: string
  /** Member name; defaults to the provider name. */
  readonly name?: string
}

/** Debate role of one recorded turn. */
export type DebateRole = 'position' | 'objection' | 'rebuttal' | 'evidence' | 'synthesis'

/**
 * Verdict the dedicated moderator publishes after Final Synthesis.
 * `consensus` requires unanimity; `majority` reports the larger side without
 * certifying its claim; `evidence-based` lets the strongest evidence win even
 * when it is a minority position; `no-consensus` reports the disagreement
 * plainly. A majority verdict never counts as proof of a minority-refuted
 * claim.
 */
export type DebateVerdictMode = 'consensus' | 'majority' | 'evidence-based' | 'no-consensus'

/** One verbatim debate turn with its speaker identity. */
export interface DebateEntry {
  /** Zero-based round the turn was produced in. */
  readonly round: number
  /** Debate role. */
  readonly role: DebateRole
  /** Participant name. */
  readonly participant: string
  /** Source connection (Harness execution identity). */
  readonly sourceHarness: string
  /** Verbatim turn text. */
  readonly text: string
}

/** Input for `conductDebate`. */
export interface DebateRequest {
  /** The shared problem statement every participant receives verbatim. */
  readonly topic: string
  /** Seats across one or more Harnesses. */
  readonly participants: readonly DebateParticipantSpec[]
  /**
   * Dedicated moderator seat for Final Synthesis. The moderator is a separate
   * seat with its own provider and speaking name; it never reuses the first
   * participant's synthesizer identity. When omitted, the moderator runs as
   * `moderator` on the `spawn` (in-harness) connection so a simple debate does
   * not summon an expensive external Harness for moderation.
   */
  readonly moderator?: DebateParticipantSpec
  /** Rounds of cross-examination after initial positions (default 1). */
  readonly maxRounds?: number
  /** Caller cancellation for the whole debate. */
  readonly signal: AbortSignal
}

/** One recorded failure of one participant during the debate. */
export interface DebateFailure {
  /** Participant name that produced no further output. */
  readonly participant: string
  /** Member-facing reason, preserving the original error text. */
  readonly reason: string
}

/** The orchestrator's published outcome. */
export interface DebateResult {
  /** The shared problem. */
  readonly topic: string
  /** Every recorded turn in round order. */
  readonly entries: readonly DebateEntry[]
  /** Verbatim synthesis text. */
  readonly synthesis: string
  /** Verdict the moderator published. */
  readonly verdictMode: DebateVerdictMode
  /** Whether the moderator reported consensus. True only for `consensus` verdicts. */
  readonly consensus: boolean
  /** Disagreements the moderator reported unresolved. */
  readonly unresolved: readonly string[]
  /** Minority evidence lines the moderator required a majority not to certify away. */
  readonly minorityEvidence: readonly string[]
  /** Moderator speaking name. */
  readonly moderator: string
  /** Moderator connection (Harness execution identity). */
  readonly moderatorHarness: string
  /** Per-seat failures that did not stop the debate. */
  readonly failures: readonly DebateFailure[]
}

/** One numbered line: participant, Harness, role, and verbatim text. */
function formatEntry(entry: DebateEntry): string {
  return `[${entry.participant} via ${entry.sourceHarness} / ${entry.role}] ${entry.text}`
}

/**
 * The brief every living seat reads: the latest turn of every other seat.
 * @param participants - every seat in the debate, with its resolved name.
 * @param failed - the seats that already failed.
 * @param entries - the transcript so far.
 * @returns the brief per living seat.
 */
function briefsFor(
  participants: readonly { readonly provider: string; readonly name: string }[],
  failed: ReadonlySet<string>,
  entries: readonly DebateEntry[],
): Map<string, string> {
  const alive = participants.filter(seat => !failed.has(seat.name))
  const latest = alive.map(seat =>
    [...entries].reverse().find(entry => entry.participant === seat.name),
  )
  const briefs = new Map<string, string>()
  for (const seat of alive) {
    const others = alive
      .filter(other => other.name !== seat.name)
      .map(other => latest.find(entry => entry?.participant === other.name))
    briefs.set(
      seat.name,
      others.map(entry => (entry === undefined ? '' : formatEntry(entry))).join('\n'),
    )
  }
  return briefs
}

/**
 * Render the shared transcript one participant reads before its next turn.
 * @param entries - recorded turns so far.
 * @returns the transcript block in round order.
 */
function transcript(entries: readonly DebateEntry[]): string {
  return entries.map(formatEntry).join('\n')
}

/**
 * A reported value that says "nothing to report". A moderator that writes
 * `UNRESOLVED: (none)` instead of omitting the line must not put a
 * placeholder into the debate result.
 */
const EMPTY_REPORT = new RegExp(
  '^(?:\\(?\\s*(?:none|n/a|na|nothing|nil|not applicable)\\b'
  + '|\\(?\\s*no\\s+(?:unresolved|minority|disagreements?)\\b'
  + '|\\s*[-–—]\\s*)',
  'iu',
)

/**
 * Normalize one verdict line so a moderator's markdown does not hide the
 * field. Block and list markers, emphasis around the label, and emphasis
 * around the value are removed before the field is read.
 * @param line - one trimmed line of the moderator's output.
 * @returns the line without its structural markup.
 */
function normalizeVerdictLine(line: string): string {
  return line
    .replace(/^(?:[>*#]+\s*)+/u, '')
    .replace(/^\d+[.)]\s+/u, '')
    .replace(/^(?:\*\*|__|\*|_|`)\s*/u, '')
    .replace(/\s*(?:\*\*|__|\*|_|`)$/u, '')
    .replace(/:\s*(?:(?:\*\*|__|\*|_|`)\s*)+/u, ': ')
    .trim()
}

/**
 * Parse the moderator's structured verdict. The moderator is instructed to
 * answer with `VERDICT:`, `CONSENSUS:`, `UNRESOLVED:`, and
 * `MINORITY-EVIDENCE:` lines. A synthesis without a `VERDICT:` line falls
 * back to its `CONSENSUS:` line so older capped transcripts stay readable.
 * @param text - verbatim moderator output.
 * @returns verdict mode, consensus flag, unresolved items, and minority evidence (empty means none reported).
 */
function parseVerdict(text: string): {
  readonly verdictMode: DebateVerdictMode
  readonly consensus: boolean
  readonly unresolved: readonly string[]
  readonly minorityEvidence: readonly string[]
} {
  const lines = text.split('\n').map(line => normalizeVerdictLine(line.trim())).filter(line => line !== '')
  const unresolved: string[] = []
  const minorityEvidence: string[] = []
  let verdictMode: DebateVerdictMode | undefined
  let legacyConsensus: boolean | undefined
  const reported = (value: string): string | undefined => {
    const trimmed = value.trim()
    return trimmed === '' || EMPTY_REPORT.test(trimmed) ? undefined : trimmed
  }
  for (const line of lines) {
    const verdictMatch = /^VERDICT:\s*(.+)$/iu.exec(line)
    if (verdictMatch?.[1]) {
      const normalized = verdictMatch[1].trim().toLowerCase().replace(/\s+/gu, '-')
      if (
        normalized === 'consensus'
        || normalized === 'majority'
        || normalized === 'evidence-based'
        || normalized === 'no-consensus'
      ) {
        verdictMode = normalized
      }
    }
    if (/^CONSENSUS:\s*yes/i.test(line)) legacyConsensus = true
    if (/^CONSENSUS:\s*no/i.test(line)) legacyConsensus = false
    const unresolvedMatch = /^UNRESOLVED:\s*(.*)$/iu.exec(line)
    const unresolvedValue = unresolvedMatch?.[1] === undefined ? undefined : reported(unresolvedMatch[1])
    if (unresolvedValue !== undefined) unresolved.push(unresolvedValue)
    const minorityMatch = /^MINORITY-EVIDENCE:\s*(.*)$/iu.exec(line) ?? /^MINORITY:\s*(.*)$/iu.exec(line)
    const minorityValue = minorityMatch?.[1] === undefined ? undefined : reported(minorityMatch[1])
    if (minorityValue !== undefined) minorityEvidence.push(minorityValue)
  }
  const resolved: DebateVerdictMode = verdictMode ?? (legacyConsensus === true ? 'consensus' : 'no-consensus')
  return { verdictMode: resolved, consensus: resolved === 'consensus', unresolved, minorityEvidence }
}

/** Ports the orchestrator needs; TeamService wires the roster and mailbox. */
export interface DebatePorts {
  /** Spawn one participant with its initial problem prompt. @returns the member name. */
  readonly spawn: (provider: string, name: string, prompt: string, signal: AbortSignal) => Promise<void>
  /** Deliver one message to one participant. */
  readonly send: (target: string, content: string, signal: AbortSignal) => Promise<void>
  /** Collect one participant's next turn (waits for the member to speak). */
  readonly collect: (participant: string, signal: AbortSignal) => Promise<string>
  /** Dispose one participant after the debate. */
  readonly dispose: (participant: string) => Promise<void>
}

/**
 * Run the five-phase debate and publish its synthesis.
 * @param ports - roster/mailbox operations.
 * @param request - topic, seats, moderator, and cancellation.
 * @returns the full transcript, synthesis, verdict, and per-seat failures.
 */
export async function runDebate(ports: DebatePorts, request: DebateRequest): Promise<DebateResult> {
  const signal = request.signal
  if (signal.aborted) throw new Error('debate cancelled before it started')
  if (request.participants.length === 0) throw new Error('debate requires at least one participant')
  const maxRounds = request.maxRounds ?? 1
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 0) {
    throw new Error('debate maxRounds must be a non-negative integer')
  }

  const names = new Map<string, string>()
  const entries: DebateEntry[] = []
  const failures: DebateFailure[] = []
  const failed = new Set<string>()
  const participants = request.participants.map((spec) => {
    const name = spec.name ?? spec.provider
    names.set(spec.provider, name)
    return { provider: spec.provider, name }
  })

  const moderatorSpec = request.moderator ?? { provider: 'spawn', name: 'moderator' }
  const moderator = { provider: moderatorSpec.provider, name: moderatorSpec.name ?? moderatorSpec.provider }
  if (participants.some(seat => seat.name === moderator.name)) {
    throw new Error('debate moderator name must differ from every participant name')
  }

  /** Collect one seat's turn, containing a child error to a single seat. */
  async function collectSeat(
    seat: { readonly provider: string; readonly name: string },
    turnSignal: AbortSignal,
  ): Promise<string | undefined> {
    try {
      return await ports.collect(seat.name, turnSignal)
    } catch (error) {
      if (turnSignal.aborted) throw error
      failed.add(seat.name)
      failures.push({
        participant: seat.name,
        reason: error instanceof Error ? error.message : String(error),
      })
      await ports.dispose(seat.name).catch(() => {})
      return undefined
    }
  }

  try {
    // Phase 1 — Independent Proposals: every seat states a position from the
    // same prompt without seeing the others.
    for (const seat of participants) {
      await ports.spawn(seat.provider, seat.name, request.topic, signal)
    }
    for (const seat of participants) {
      const text = await collectSeat(seat, signal)
      if (text !== undefined) {
        entries.push({ round: 0, role: 'position', participant: seat.name, sourceHarness: seat.provider, text })
      }
    }
    // Phases 2 and 3 — Cross-Examination and Rebuttal. Each seat reads every
    // other seat's latest turn, then objects or rebuts. Only the latest turns
    // are sent so later rounds critique refined positions, not stale ones. A
    // seat that produced no output for a round is skipped rather than holding
    // the round.
    for (let round = 1; round <= maxRounds; round += 1) {
      const briefs = briefsFor(participants, failed, entries)
      for (const seat of participants.filter(seat => !failed.has(seat.name))) {
        const brief = briefs.get(seat.name) ?? ''
        const role: DebateRole = round % 2 === 1 ? 'objection' : 'rebuttal'
        await ports.send(seat.name, `ROUND ${round} — ${role.toUpperCase()}\n${brief}`, signal)
      }
      for (const seat of participants.filter(seat => !failed.has(seat.name))) {
        const text = await collectSeat(seat, signal)
        if (text !== undefined) {
          entries.push({ round, role: round % 2 === 1 ? 'objection' : 'rebuttal', participant: seat.name, sourceHarness: seat.provider, text })
        }
      }
    }
    // Phase 4 — Evidence Review: each alive seat cites code, tests, or
    // references for and against the claims in the transcript. Evidence turns
    // keep their participant and source-Harness identity like every other
    // role, so the moderator can weight a minority claim that carries proof
    // above a majority that carries none.
    const evidenceRound = maxRounds + 1
    if (maxRounds > 0) {
      const briefs = briefsFor(participants, failed, entries)
      for (const seat of participants.filter(seat => !failed.has(seat.name))) {
        const brief = briefs.get(seat.name) ?? ''
        await ports.send(
          seat.name,
          `ROUND ${evidenceRound} — EVIDENCE\nCite code, tests, or references for and against each claim in the transcript. A claim without evidence stays a claim.\n${brief}`,
          signal,
        )
      }
      for (const seat of participants.filter(seat => !failed.has(seat.name))) {
        const text = await collectSeat(seat, signal)
        if (text !== undefined) {
          entries.push({ round: evidenceRound, role: 'evidence', participant: seat.name, sourceHarness: seat.provider, text })
        }
      }
    }
    // Phase 5 — Final Synthesis: the dedicated moderator reads the whole
    // transcript and publishes one of four verdicts, the disagreements it
    // could not settle, and any minority evidence a majority must not
    // certify away.
    const synthesisPrompt = [
      'You are the debate moderator. Read the full transcript below and publish:',
      '1. VERDICT: consensus | majority | evidence-based | no-consensus (one line)',
      '2. CONSENSUS: yes only for a consensus verdict, otherwise no',
      '3. One UNRESOLVED: <disagreement> line per unsettled disagreement (omit when none)',
      '4. One MINORITY-EVIDENCE: <evidence> line per minority position that carries supporting evidence (omit when none; required when a minority claim is evidenced, so a majority cannot certify a false claim)',
      '5. A short synthesis naming what was agreed, what remains disputed, what evidence supported each side, and the confidence level.',
      ...(failures.length > 0
        ? [`${failures.length} participant(s) failed to respond: ${failures.map(failure => failure.participant).join(', ')}.`]
        : []),
      '---',
      transcript(entries),
    ].join('\n')
    const synthesisRound = maxRounds > 0 ? maxRounds + 2 : 1
    await ports.spawn(moderator.provider, moderator.name, synthesisPrompt, signal)
    const synthesis = await collectSeat(moderator, signal)
    if (synthesis === undefined) {
      const moderatorFailure = failures.find(failure => failure.participant === moderator.name)
      throw new Error(moderatorFailure === undefined
        ? 'debate synthesis could not be collected'
        : `debate synthesis could not be collected: ${moderatorFailure.reason}`)
    }
    entries.push({ round: synthesisRound, role: 'synthesis', participant: moderator.name, sourceHarness: moderator.provider, text: synthesis })
    await ports.dispose(moderator.name)
    const verdict = parseVerdict(synthesis)
    return {
      topic: request.topic,
      entries,
      synthesis,
      verdictMode: verdict.verdictMode,
      consensus: verdict.consensus,
      unresolved: verdict.unresolved,
      minorityEvidence: verdict.minorityEvidence,
      moderator: moderator.name,
      moderatorHarness: moderator.provider,
      failures,
    }
  } finally {
    for (const seat of participants) await ports.dispose(seat.name).catch(() => {})
  }
}
