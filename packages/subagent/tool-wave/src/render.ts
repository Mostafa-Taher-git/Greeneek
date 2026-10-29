/**
 * Rendering of settled wave results and cancel outcomes into the canonical
 * tool-output report values and their compact model-facing text. Pure over
 * the engine's settled records: the wave engine already applies its result
 * byte cap, and this layer never reintroduces member transcripts beyond the
 * capped final outputs.
 *
 * @module @greeneek/gnk-tool-wave/render
 */

import type { ContentBlock } from '@greeneek/gnk-llm'
import type {
  WaveId,
  WaveMemberResult,
  WaveMemberStatus,
  WaveResult,
  WaveView,
} from '@greeneek/gnk-subagent-wave'
import type { JsonValue } from '@greeneek/gnk-util-values'

/**
 * Terminal statuses a settled wave member record can carry. The engine
 * settles a member only past its terminal status assignment and closes the
 * wave only after every member settled, so `queued`/`running` cannot reach a
 * report — the same narrowing the engine's own `memberRow` performs.
 */
export type WaveMemberStatusReport = Exclude<WaveMemberStatus, 'queued' | 'running'>

/**
 * Sanitize the validated artifact pointers of one member envelope into lossless
 * JSON rows. The engine already validated shape and bounds, so the only
 * transformation here is the JSON boundary itself.
 * @param member - the settled member record.
 * @returns the pointer rows, or an empty spread when the member named none.
 */
function artifactsRow(member: WaveMemberResult): { artifacts?: JsonValue[] } {
  const artifacts = member.envelope.artifacts
  if (artifacts === undefined) return {}
  const sanitized: JsonValue[] = []
  for (const pointer of artifacts) {
    try {
      sanitized.push(JSON.parse(JSON.stringify(pointer)) as JsonValue)
    } catch {
      // An unrepresentable pointer cannot render; skip it and keep the rest.
    }
  }
  return sanitized.length === 0 ? {} : { artifacts: sanitized }
}

/** One member row of the settled-wave report. */
export interface WaveMemberReportRow {
  /** Dispatch position within the wave. */
  readonly index: number
  /** Engine-minted member id, `<waveId>:<index>`. */
  readonly member_id: string
  /** Registry provider that established the child. */
  readonly provider: string
  /** Display role from the member's spec. */
  readonly role?: string
  /** Provider model id pinned through this member's agent options. */
  readonly model?: string
  /** Terminal status. */
  readonly status: WaveMemberStatusReport
  /** Terminal stop reason; absent when the member never resolved a child result. */
  readonly stop_reason?: string
  /** Published child session id; absent when the member never launched. */
  readonly child_session_id?: string
  /** Cumulative child tokens measured at settlement. */
  readonly tokens_used: number
  /** Non-`completed` settlement detail of a cancelled, failed, or budget-killed member. */
  readonly diagnostic?: string
  /** Whether the engine capped this member's output or dropped its structured value. */
  readonly truncated: boolean
  /** The engine-capped final assistant output, as lossless content-block JSON. */
  readonly output: JsonValue[]
  /** The engine-capped structured result, JSON-sanitized. */
  readonly structured?: JsonValue
  /** The engine-validated artifact pointers the member's structured result named. */
  readonly artifacts?: JsonValue[]
}

/** Canonical value of `wave_dispatch`. */
export interface WaveReport {
  /** The wave's identity. */
  readonly wave_id: string
  /** How the wave settled across its members. */
  readonly outcome: WaveResult['outcome']
  /** Every member's terminal row in dispatch order. */
  readonly rows: WaveMemberReportRow[]
}

/** One wave's cancel outcome. */
export interface CancelReportRow {
  /** The addressed wave id. */
  readonly wave_id: string
  /** `cancelled` when the abort was delivered; `already settled` for a closed wave. */
  readonly outcome: 'cancelled' | 'already settled'
}

/** Canonical value of `wave_cancel`. */
export interface CancelReport {
  /** The addressed wave id, echoed when the model named one. */
  readonly wave_id?: string
  /** One row per addressed wave. */
  readonly rows: CancelReportRow[]
}

/**
 * Clone a structured result value through lossless JSON. A value the JSON
 * boundary cannot represent (cyclic or BigInt data the engine size check
 * could still pass on a planar shape) is dropped rather than failing the
 * settled report; the truncation flag is untouched here.
 * @param value - the engine's structured result.
 * @returns the sanitized value, or `undefined` when absent or unrepresentable.
 */
export function sanitizeStructured(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch {
    return undefined
  }
}

/**
 * The structured field of one report row, omitted when the member is absent
 * or its structured value failed sanitization.
 * @param member - the settled member.
 * @returns the field, or an empty spread.
 */
function structuredRow(member: WaveMemberResult): { structured?: JsonValue } {
  const structured = sanitizeStructured(member.structured)
  return structured === undefined ? {} : { structured }
}

/**
 * One settled member's report row. Callers run this only on a settled wave,
 * so every field the engine carried at settlement is terminal data.
 * @param member - the settled member record.
 * @param index - the member's dispatch position.
 * @returns the report row.
 */
export function memberReportRow(member: WaveMemberResult, index: number): WaveMemberReportRow {
  return {
    index,
    member_id: String(member.memberId),
    provider: member.provider,
    // The engine readies views by `viewMember` before dispatch-order mapping,
    // so provider identity is always defined; status mirrors the engine's
    // own `memberRow`: settled members are always terminal.
    status: member.status as WaveMemberStatusReport,
    tokens_used: member.tokensUsed,
    truncated: member.envelope.truncated,
    // Content blocks cross durable JSON boundaries elsewhere in the repo;
    // the registry performs the authoritative lossless snapshot when the
    // tool result is logged.
    output: member.output as unknown as JsonValue[],
    ...(member.role === undefined ? {} : { role: member.role }),
    ...(member.model === undefined ? {} : { model: member.model }),
    ...(member.envelope.stopReason === undefined ? {} : { stop_reason: member.envelope.stopReason }),
    ...(member.childSessionId === undefined ? {} : { child_session_id: String(member.childSessionId) }),
    ...(member.diagnostic === undefined ? {} : { diagnostic: member.diagnostic }),
    ...structuredRow(member),
    ...artifactsRow(member),
  }
}

/**
 * Build the canonical dispatch report from a settled wave result.
 * @param result - the engine's settled wave.
 * @returns the report value in dispatch order.
 */
export function waveReportValue(result: WaveResult): WaveReport {
  return {
    wave_id: String(result.waveId),
    outcome: result.outcome,
    rows: result.members.map((member, index) => memberReportRow(member, index)),
  }
}

/**
 * Turn the retained views of one Lead session into cancel outcomes. The
 * engine's `cancelWave` throws for a foreign wave id and is a no-op on a
 * closed wave, so the tool scopes through the calling parent's retained
 * views first and aborts only still-open matches.
 * @param views - retained wave views of the calling parent session.
 * @param waveId - the addressed wave id, or `undefined` for cancel-all.
 * @param cancel - engine cancel applied to every still-open match.
 * @returns one row per addressed wave.
 */
export function cancelWaveValue(
  views: readonly WaveView[],
  waveId: string | undefined,
  cancel: (waveId: WaveId) => void,
): CancelReport {
  const matched = waveId === undefined
    ? [...views]
    : views.filter(view => String(view.waveId) === waveId)
  const rows = matched.map((view): CancelReportRow => {
    if (view.closed) return { wave_id: String(view.waveId), outcome: 'already settled' }
    cancel(view.waveId)
    return { wave_id: String(view.waveId), outcome: 'cancelled' }
  })
  return {
    ...(waveId === undefined ? {} : { wave_id: waveId }),
    rows,
  }
}

/**
 * One member row's fact fragments: child session, stop reason, model, and
 * truncation, joined for the row's detail line.
 * @param row - the report row.
 * @returns the joined facts, or `''` when none apply.
 */
function renderFacts(row: WaveMemberReportRow): string {
  return [
    ...(row.child_session_id === undefined ? [] : [`child session ${row.child_session_id}`]),
    ...(row.stop_reason === undefined ? [] : [`stop reason ${row.stop_reason}`]),
    ...(row.model === undefined ? [] : [`model ${row.model}`]),
    ...(row.truncated ? ['truncated'] : []),
  ].join(', ')
}

/**
 * One member row's artifacts line: the validated pointers as `kind value`
 * fragments, joined for a single detail line.
 * @param row - the report row.
 * @returns the joined artifacts line, or `undefined` when the member named none.
 */
function renderArtifacts(row: WaveMemberReportRow): string | undefined {
  const artifacts = row.artifacts
  if (artifacts === undefined) return undefined
  const fragments: string[] = []
  for (const pointer of artifacts) {
    if (typeof pointer !== 'object' || pointer === null || Array.isArray(pointer)) continue
    if (pointer.kind === 'file' && typeof pointer.path === 'string') fragments.push(`file ${pointer.path}`)
    else if (pointer.kind === 'uri' && typeof pointer.uri === 'string') fragments.push(`uri ${pointer.uri}`)
  }
  return fragments.length === 0 ? undefined : `artifacts: ${fragments.join(', ')}`
}

/**
 * Flatten the text blocks of one member's capped output. Non-text blocks are
 * report-only data: their kind is not addressable prose, so they are skipped
 * instead of stringified.
 * @param blocks - the output blocks.
 * @returns the joined text.
 */
function outputText(blocks: readonly JsonValue[]): string {
  return blocks
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && !Array.isArray(block)
      && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Render the model-facing text of a settled wave: a one-line header, one row
 * per member, and per-row detail — diagnostic, structured value, and the
 * flattened output.
 * @param report - the canonical report value.
 * @returns one text block.
 */
export function renderWaveReport(report: WaveReport): ContentBlock[] {
  const lines = [
    `Wave ${report.wave_id} settled: ${report.outcome}, ${report.rows.length} member row(s).`,
  ]
  for (const row of report.rows) {
    lines.push(`[${row.index}] ${row.provider}${row.role === undefined ? '' : ` (${row.role})`} — ${row.status} — ${row.tokens_used} tokens`)
    const facts = renderFacts(row)
    if (facts.length > 0) lines.push(`  ${facts}`)
    if (row.diagnostic !== undefined) lines.push(`  diagnostic: ${row.diagnostic}`)
    if (row.structured !== undefined) lines.push(`  structured: ${JSON.stringify(row.structured)}`)
    const artifacts = renderArtifacts(row)
    if (artifacts !== undefined) lines.push(`  ${artifacts}`)
    lines.push(`  output: ${outputText(row.output)}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * Render the model-facing text of a cancel outcome. No matches render a
 * denial ("not retained") when the model addressed one wave and an empty
 * session statement when it did not address any.
 * @param report - the canonical cancel value.
 * @returns one text block; multi-wave outcomes use one line per wave.
 */
export function renderCancelReport(report: CancelReport): ContentBlock[] {
  if (report.rows.length === 0) {
    return [{
      type: 'text',
      text: report.wave_id === undefined
        ? 'No retained waves for this session.'
        : `Wave ${report.wave_id} is not retained for this session.`,
    }]
  }
  return [{
    type: 'text',
    text: report.rows.map(row => `Wave ${row.wave_id} ${row.outcome}.`).join('\n'),
  }]
}
