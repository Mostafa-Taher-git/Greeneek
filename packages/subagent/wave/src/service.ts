/**
 * `ctx.waves`: the Army wave engine. One host-plane service turns a Lead
 * agent's {@link WaveRequest} into many concurrently launched one-shot
 * subagent children under a shared concurrency cap, per-member and per-wave
 * token budgets enforced at `agent/pre-step`, engine-owned cancellation, and
 * deterministic spec-order results.
 *
 * Cancellation is engine-minted: each member gets an `AbortController` at
 * admission, so a cancel reaches a member whether it is queued, launching, or
 * published. Browser control rides the `@Remote` face; lifetime retention is
 * one wave per entry until its Lead agent disposes.
 *
 * @module @greeneek/gnk-subagent-wave
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type { Agent } from '@greeneek/gnk-agent'
import type { ContentBlock } from '@greeneek/gnk-llm'
import type { TokenUsageProjection } from '@greeneek/gnk-token-meter'
import type { SessionId } from '@greeneek/gnk-session'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { z as zod } from 'zod'
import { WaveError } from './error.ts'
import { Semaphore } from './semaphore.ts'
import type { SubagentResult, SubagentRun } from '@greeneek/gnk-subagent'
import type {
  ResolvedWaveConfig,
  WaveId,
  WaveMemberId,
  WaveMemberResult,
  WaveMemberSpec,
  WaveMemberStatus,
  WaveMemberView,
  WaveRequest,
  WaveResult,
  WaveRuntimeConfig,
  WaveView,
} from './types.ts'
import { WaveId as WaveIdBrand, WaveMemberId as WaveMemberIdBrand } from './types.ts'

declare module '@greeneek/cordis' {
  interface Context {
    waves: WaveRuntime
  }
}

declare module '@greeneek/gnk-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No retained wave carries the addressed id. */
    'wave/not-found': { readonly waveId: string }
    /** The addressed wave retains no member with that id. */
    'wave/member-not-found': { readonly waveId: string; readonly memberId: string }
  }
}

/** Default simultaneous-launch cap. */
export const DEFAULT_MAX_CONCURRENT = 8
/** Hard cap on {@link WaveRuntimeConfig.maxConcurrent}. */
export const MAX_CONCURRENT_CEILING = 16
/** Default per-member settled-output byte cap. */
export const DEFAULT_MAX_RESULT_BYTES = 16_384
/** Hard cap on {@link WaveRuntimeConfig.maxResultBytes}. */
export const MAX_RESULT_BYTES_CEILING = 1_048_576

/** Engine configuration schema; loader-supplied bounds fail at load. */
export const Config: z<WaveRuntimeConfig> = z.object({
  maxConcurrent: z.number().step(1).min(1).max(MAX_CONCURRENT_CEILING).default(DEFAULT_MAX_CONCURRENT),
  maxResultBytes: z.number().step(1).min(1024).max(MAX_RESULT_BYTES_CEILING).default(DEFAULT_MAX_RESULT_BYTES),
})

const ID_SCHEMA = zod.string().min(1)
const CONTROL_SCHEMAS = {
  'wave.list': zod.object({ parentSessionId: ID_SCHEMA }),
  'wave.cancelMember': zod.object({ waveId: ID_SCHEMA, memberId: ID_SCHEMA }),
  'wave.cancelWave': zod.object({ waveId: ID_SCHEMA }),
  'wave.cancelAll': zod.object({ parentSessionId: ID_SCHEMA }),
} as const

type ControlMethod = keyof typeof CONTROL_SCHEMAS

/** Validate one remote control payload beyond the branded-string codecs. */
function validateControlRequest(method: ControlMethod, payload: unknown): void {
  const parsed = CONTROL_SCHEMAS[method].safeParse(payload)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
}

/** Cumulative provider-reported usage from the token-usage projection state. */
function cumulativeTokens(state: { totals: TokenUsageProjection }): number {
  return state.totals.uncachedInputTokens + state.totals.outputTokens + state.totals.cacheReadTokens + state.totals.cacheWriteTokens
}

/** Read mutable cancellation state without TypeScript narrowing it across awaits. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

interface MemberState {
  readonly memberId: WaveMemberId
  readonly spec: WaveMemberSpec
  readonly controller: AbortController
  /** Dispatch index; carried to the durable settlement records. */
  readonly index: number
  status: WaveMemberStatus
  childSessionId: SessionId | undefined
  tokensUsed: number
  budgetKilled: boolean
  diagnostic: string | undefined
  /** True once the member's durable settlement record is written. */
  settled: boolean
  /** Kept for the terminal record; capped when the wave closes. */
  result: SubagentResult | undefined
}

interface WaveState {
  readonly waveId: WaveId
  readonly label: string
  readonly parentSessionId: SessionId
  readonly parent: Agent
  readonly request: WaveRequest
  readonly members: MemberState[]
  closed: boolean
  resolveDone: (result: WaveResult) => void
}

/** Terminal settlement statuses; a durable record never carries `queued`/`running`. */
type TerminalWaveMemberStatus = Exclude<WaveMemberStatus, 'queued' | 'running'>

/**
 * Truncate one text string to at most `maxBytes` UTF-8 bytes without
 * splitting a code point; a partial trailing sequence is dropped.
 * @param text - the source text.
 * @param maxBytes - the byte ceiling the result must satisfy.
 * @returns the truncated text.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const bytes = Buffer.from(text, 'utf8').subarray(0, maxBytes)
  let end = maxBytes
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.subarray(0, end))
    } catch {
      /* the trailing sequence is incomplete; retry one byte shorter */
    }
  }
  return ''
}

function contentByteSize(content: readonly ContentBlock[]): number {
  let total = 0
  for (const block of content) {
    total += block.type === 'text' ? Buffer.byteLength(block.text, 'utf8') : 0
  }
  return total
}

/**
 * Wave engine over the subagent seam. One instance per context; every wave is
 * bound to its Lead agent's lifetime.
 */
export class WaveRuntime extends TypertRemoteService {
  static Config: z<WaveRuntimeConfig> = Config
  static inject = ['subagents']

  private readonly config: ResolvedWaveConfig
  private readonly semaphore: Semaphore
  private readonly waves = new Map<WaveId, WaveState>()
  private readonly tasks = new Set<Promise<void>>()
  /** Published child session id → owning member, for budget metering and lineage. */
  private readonly childIndex = new Map<string, { wave: WaveState; member: MemberState }>()

  /**
   * @param ctx - owning context.
   * @param config - concurrency cap and result byte cap.
   */
  constructor(ctx: Context, config: WaveRuntimeConfig = {}) {
    super(ctx, 'waves')
    this.config = {
      maxConcurrent: config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      maxResultBytes: config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    }
    for (const [name, value] of Object.entries(this.config)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new WaveError(`waves: ${name} must be a positive safe integer`, 'INVALID_CONFIG')
      }
    }
    if (this.config.maxConcurrent > MAX_CONCURRENT_CEILING) {
      throw new WaveError(`waves: maxConcurrent must not exceed ${MAX_CONCURRENT_CEILING}`, 'INVALID_CONFIG')
    }
    if (this.config.maxResultBytes < 1024 || this.config.maxResultBytes > MAX_RESULT_BYTES_CEILING) {
      throw new WaveError(`waves: maxResultBytes must be between 1024 and ${MAX_RESULT_BYTES_CEILING}`, 'INVALID_CONFIG')
    }
    this.semaphore = new Semaphore(this.config.maxConcurrent)
    ctx.effect(() => async () => {
      for (const wave of this.waves.values()) {
        if (!wave.closed) this.abortWave(wave, 'engine disposed')
      }
      await Promise.all([...this.tasks])
    }, 'waves.teardown')
    ctx.on('agent/disposed', ({ agent }) => {
      for (const wave of [...this.waves.values()]) {
        if (wave.parentSessionId !== agent.id) continue
        if (!wave.closed) this.abortWave(wave, 'parent disposed')
        this.waves.delete(wave.waveId)
        for (const member of wave.members) {
          if (member.childSessionId !== undefined) this.childIndex.delete(String(member.childSessionId))
        }
      }
    })
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const decision = this.enforceBudget(agent)
      if (decision !== undefined) return decision
      return next()
    })
  }

  /**
   * Accept one wave and launch all members under the shared concurrency cap.
   * Resolves when every member has settled (or been cancelled), with results
   * in dispatch order. Never rejects for a member-level failure; those settle
   * as `failed`/`budget-killed` rows.
   * @param request - Lead agent, label, member specs, completion and budget policy.
   * @returns the settled wave.
   * @throws {@link WaveError} `EMPTY_WAVE` for no members or `NO_PROVIDER` for
   *   a provider the subagent registry does not resolve.
   */
  async startWave(request: WaveRequest): Promise<WaveResult> {
    if (request.members.length === 0) {
      throw new WaveError('a wave requires at least one member', 'EMPTY_WAVE')
    }
    for (const spec of request.members) {
      if (this.ctx.subagents.getProvider(spec.provider) === undefined) {
        throw new WaveError(`no subagent provider registered for "${spec.provider}"`, 'NO_PROVIDER')
      }
    }
    if (
      (request.maxTokensPerMember !== undefined || request.maxWaveTokens !== undefined)
      && this.ctx.get('sessionProjections')?.stateOf(request.parent.session, 'tokenUsage') === undefined
    ) {
      throw new WaveError('wave token budgets require the tokenUsage session projection', 'BUDGET_METER_UNAVAILABLE')
    }
    const waveId = WaveIdBrand(randomUUID())
    let resolveDone!: (result: WaveResult) => void
    const done = new Promise<WaveResult>((resolve) => {
      resolveDone = resolve
    })
    const members: MemberState[] = request.members.map((spec, index) => ({
      memberId: WaveMemberIdBrand(`${String(waveId)}:${index}`),
      spec,
      controller: new AbortController(),
      index,
      status: 'queued' as WaveMemberStatus,
      childSessionId: undefined,
      tokensUsed: 0,
      budgetKilled: false,
      diagnostic: undefined,
      settled: false,
      result: undefined,
    }))
    const wave: WaveState = {
      waveId,
      label: request.label,
      parentSessionId: request.parent.session.id,
      parent: request.parent,
      request,
      members,
      closed: false,
      resolveDone,
    }
    // Durable admission precedes membership, so a failed append rejects
    // startWave before any member launches — all-or-nothing admission.
    this.appendInitiated(wave)
    this.waves.set(waveId, wave)
    for (const member of members) {
      const task = this.runMember(wave, member)
      this.tasks.add(task)
      void task.then(() => {
        this.tasks.delete(task)
      })
    }
    return done
  }

  /**
   * Live snapshots for one Lead session, in acceptance order; closed waves
   * remain listed until their Lead agent disposes.
   * @param parentSessionId - the Lead session address.
   * @returns every retained wave view for that parent.
   */
  listWaves(parentSessionId: SessionId): readonly WaveView[] {
    const views: WaveView[] = []
    for (const wave of this.waves.values()) {
      if (wave.parentSessionId === parentSessionId) views.push(this.viewOf(wave))
    }
    return views
  }

  /**
   * Cancel one member. A queued member settles without launching; a running
   * member's child observes the abort signal.
   * @param waveId - the owning wave.
   * @param memberId - the target member.
   * @throws {@link WaveError} `WAVE_NOT_FOUND` or `MEMBER_NOT_FOUND`.
   */
  cancelMember(waveId: WaveId, memberId: WaveMemberId): void {
    const wave = this.waves.get(waveId)
    if (wave === undefined) throw new WaveError(`no wave "${String(waveId)}" is retained`, 'WAVE_NOT_FOUND')
    const member = wave.members.find(candidate => candidate.memberId === memberId)
    if (member === undefined) throw new WaveError(`wave "${String(waveId)}" has no member "${String(memberId)}"`, 'MEMBER_NOT_FOUND')
    if (wave.closed || isAborted(member.controller.signal)) return
    member.controller.abort('member cancelled')
  }

  /**
   * Cancel every unsettled member of one wave.
   * @param waveId - the target wave.
   * @throws {@link WaveError} `WAVE_NOT_FOUND` when no wave carries the id.
   */
  cancelWave(waveId: WaveId): void {
    const wave = this.waves.get(waveId)
    if (wave === undefined) throw new WaveError(`no wave "${String(waveId)}" is retained`, 'WAVE_NOT_FOUND')
    if (wave.closed) return
    this.abortWave(wave, 'wave cancelled')
  }

  /**
   * Emergency stop: cancel every unsettled member of every wave owned by one
   * Lead session.
   * @param parentSessionId - the Lead session address.
   * @returns the ids of the waves that received the abort.
   */
  cancelAllForParent(parentSessionId: SessionId): readonly WaveId[] {
    const aborted: WaveId[] = []
    for (const wave of this.waves.values()) {
      if (wave.parentSessionId !== parentSessionId || wave.closed) continue
      this.abortWave(wave, 'emergency stop')
      aborted.push(wave.waveId)
    }
    return aborted
  }

  /**
   * Remote face of {@link listWaves}: the Lead session's fleet views in
   * acceptance order.
   * @param parentSessionId - the Lead session address.
   * @returns every retained wave view; closed waves stay listed until the Lead agent disposes.
   */
  @Remote('list')
  remoteExportList(parentSessionId: SessionId): readonly WaveView[] {
    validateControlRequest('wave.list', { parentSessionId })
    return this.listWaves(parentSessionId)
  }

  /**
   * Remote face of {@link cancelMember}; unknown ids surface as typed
   * RemoteError codes instead of host throws.
   * @param waveId - the owning wave.
   * @param memberId - the target member.
   * @returns cancellation confirmation.
   */
  @Remote('cancelMember')
  remoteCancelMember(waveId: WaveId, memberId: WaveMemberId): { cancelled: true } {
    validateControlRequest('wave.cancelMember', { waveId, memberId })
    try {
      this.cancelMember(waveId, memberId)
    } catch (error: unknown) {
      throw new RemoteError(this.remoteErrorCode(error), 'wave cancel failed', { waveId, memberId }, { cause: error })
    }
    return { cancelled: true }
  }

  /**
   * Remote face of {@link cancelWave}; unknown ids surface as typed
   * RemoteError codes instead of host throws.
   * @param waveId - the target wave.
   * @returns cancellation confirmation.
   */
  @Remote('cancelWave')
  remoteCancelWave(waveId: WaveId): { cancelled: true } {
    validateControlRequest('wave.cancelWave', { waveId })
    try {
      this.cancelWave(waveId)
    } catch (error: unknown) {
      throw new RemoteError(this.remoteErrorCode(error), 'wave cancel failed', { waveId }, { cause: error })
    }
    return { cancelled: true }
  }

  /**
   * Remote face of {@link cancelAllForParent}, the emergency stop.
   * @param parentSessionId - the Lead session address.
   * @returns the ids of the waves that received the abort.
   */
  @Remote('cancelAll')
  remoteCancelAll(parentSessionId: SessionId): { waveIds: readonly WaveId[] } {
    validateControlRequest('wave.cancelAll', { parentSessionId })
    return { waveIds: this.cancelAllForParent(parentSessionId) }
  }

  /** Map a host WaveError onto a stable browser code. */
  private remoteErrorCode(error: unknown): 'wave/not-found' | 'wave/member-not-found' | 'gateway/internal' {
    if (error instanceof WaveError && error.code === 'WAVE_NOT_FOUND') return 'wave/not-found'
    if (error instanceof WaveError && error.code === 'MEMBER_NOT_FOUND') return 'wave/member-not-found'
    return 'gateway/internal'
  }

  /** Launch one member: queue, start, observe, dispose, release. */
  private async runMember(wave: WaveState, member: MemberState): Promise<void> {
    let release: (() => void) | undefined
    let run: SubagentRun | undefined
    try {
      release = await this.semaphore.acquire(member.controller.signal)
      member.controller.signal.throwIfAborted()
      member.status = 'running'
      run = await this.ctx.subagents.start(member.spec.provider, {
        ...member.spec.request,
        parent: wave.parent,
        signal: member.controller.signal,
      })
      member.childSessionId = run.id
      this.childIndex.set(String(run.id), { wave, member })
      member.result = await run.result
      member.status = member.budgetKilled
        ? 'budget-killed'
        : isAborted(member.controller.signal)
          ? 'cancelled'
          : member.result.stopReason === 'completed'
            ? 'completed'
            : 'failed'
      if (member.result.diagnostic !== undefined) member.diagnostic = member.result.diagnostic
    } catch (error: unknown) {
      const aborted = isAborted(member.controller.signal) || wave.closed
      member.status = member.budgetKilled ? 'budget-killed' : aborted ? 'cancelled' : 'failed'
      const detail = error instanceof Error ? error.message : String(error)
      // A budget kill already owns the diagnostic; a later child rejection
      // only fills one in when none exists.
      if (member.diagnostic === undefined) member.diagnostic = detail
    } finally {
      try {
        // The slot remains held until the child reaches quiescence.
        if (run !== undefined) await run.dispose()
      } catch (error: unknown) {
        if (!member.budgetKilled && !isAborted(member.controller.signal)) member.status = 'failed'
        const detail = `dispose failed: ${error instanceof Error ? error.message : String(error)}`
        member.diagnostic = member.diagnostic === undefined ? detail : `${member.diagnostic}; ${detail}`
      } finally {
        if (member.childSessionId !== undefined) this.childIndex.delete(String(member.childSessionId))
        release?.()
        this.settleMember(wave, member)
      }
    }
  }

  /** Write this member's record, then close the wave once every member settled. */
  private settleMember(wave: WaveState, member: MemberState): void {
    if (wave.closed) return
    this.appendMemberSettled(wave, member)
    const open = wave.members.some(candidate => candidate.status === 'queued' || candidate.status === 'running')
    if (!open) {
      this.closeWave(wave)
      return
    }
    // Fail-fast: one failed or budget-killed settlement aborts every sibling
    // still in flight; a user cancel does not trigger it.
    if (wave.request.onComplete === 'fail-fast') {
      const trigger = wave.members.find(
        candidate => (candidate.status === 'failed' || candidate.status === 'budget-killed')
          && candidate.childSessionId !== undefined,
      )
      if (trigger !== undefined) this.abortWave(wave, 'fail-fast')
    }
  }

  /** Build terminal records, write remaining member records plus the closing record, and resolve {@link startWave}. */
  private closeWave(wave: WaveState): void {
    wave.closed = true
    // A member still awaiting its child's disposal at close time gets its
    // durable record here; its funnel arrives after the close and writes
    // nothing more, so no member is recorded twice and none is missed.
    for (const member of wave.members) {
      this.appendMemberSettled(wave, member)
    }
    const results: WaveMemberResult[] = wave.members.map(member => this.resultOf(member))
    const statuses = results.map(member => member.status)
    const outcome = statuses.every(status => status === 'completed')
      ? 'completed'
      : statuses.every(status => status === 'cancelled')
        ? 'cancelled'
        : 'partial'
    const result: WaveResult = { waveId: wave.waveId, outcome, members: results }
    wave.parent.session.append('wave/settled', {
      waveId: String(wave.waveId),
      outcome,
      members: wave.members.map(member => this.memberRow(member)),
    })
    wave.resolveDone(result)
  }

  /**
   * Write the member's durable settlement record exactly once, guarded by
   * {@link MemberState.settled} — set only after the write commits, so a
   * failed append stays re-attemptable.
   * @param wave - the owning wave.
   * @param member - the settled member.
   */
  private appendMemberSettled(wave: WaveState, member: MemberState): void {
    if (member.settled) return
    wave.parent.session.append('wave/member-settled', {
      waveId: String(wave.waveId),
      ...this.memberRow(member),
    })
    member.settled = true
  }

  /**
   * One member's durable terminal row: the shared shape of the member's own
   * settlement record and of its row in the wave's closing record.
   * @param member - the member; a caller runs this only past terminal status.
   * @returns the JSON-safe row.
   */
  private memberRow(member: MemberState): {
    memberId: string
    memberIndex: number
    status: TerminalWaveMemberStatus
    tokensUsed: number
    diagnostic?: string
  } {
    return {
      memberId: String(member.memberId),
      memberIndex: member.index,
      // runMember settles only past the terminal status assignment, and
      // closeWave runs only after the open check, so the status is terminal.
      status: member.status as TerminalWaveMemberStatus,
      tokensUsed: member.tokensUsed,
      ...(member.diagnostic === undefined ? {} : { diagnostic: member.diagnostic }),
    }
  }

  /**
   * Write the wave's durable admission record on the Lead's session.
   * @param wave - the fully built wave; membership is final.
   */
  private appendInitiated(wave: WaveState): void {
    wave.parent.session.append('wave/initiated', {
      waveId: String(wave.waveId),
      parentSessionId: String(wave.parentSessionId),
      label: wave.label,
      onComplete: wave.request.onComplete ?? 'continue-others',
      ...(wave.request.maxTokensPerMember === undefined ? {} : { maxTokensPerMember: wave.request.maxTokensPerMember }),
      ...(wave.request.maxWaveTokens === undefined ? {} : { maxWaveTokens: wave.request.maxWaveTokens }),
      memberCount: wave.members.length,
      members: wave.members.map(member => ({
        memberId: String(member.memberId),
        provider: member.spec.provider,
        ...(member.spec.role === undefined ? {} : { role: member.spec.role }),
      })),
    })
  }

  /** Abort every unsettled member of one wave. */
  private abortWave(wave: WaveState, reason: string): void {
    for (const member of wave.members) {
      if (member.status !== 'queued' && member.status !== 'running') continue
      member.controller.abort(reason)
    }
  }

  /**
   * Enforce per-member and wave budgets at one child's step boundary.
   * @param agent - the agent about to run a step.
   * @returns a reject decision when the owning member exceeded its budget,
   *   or `undefined` to delegate.
   */
  private enforceBudget(agent: Agent): { kind: 'reject' } | undefined {
    const indexed = this.childIndex.get(String(agent.id))
    if (indexed === undefined) return undefined
    const { wave, member } = indexed
    const usage = this.ctx.get('sessionProjections')?.stateOf(agent.session, 'tokenUsage')
    const perMember = wave.request.maxTokensPerMember
    const waveCap = wave.request.maxWaveTokens
    if (usage === undefined) {
      if (perMember !== undefined || waveCap !== undefined) {
        throw new WaveError('wave token budgets require the tokenUsage session projection', 'BUDGET_METER_UNAVAILABLE')
      }
      return undefined
    }
    const tokens = cumulativeTokens(usage)
    member.tokensUsed = tokens
    if (tokens === 0) return undefined
    const waveTokens = wave.members.reduce((sum, row) => sum + row.tokensUsed, 0)
    const memberExceeded = perMember !== undefined && tokens > perMember
    const waveExceeded = waveCap !== undefined && waveTokens > waveCap
    if (memberExceeded || waveExceeded) {
      member.budgetKilled = true
      member.diagnostic = waveExceeded ? 'wave token budget exceeded' : 'member token budget exceeded'
      if (waveExceeded) {
        this.abortWave(wave, 'wave budget exceeded')
      } else {
        member.controller.abort('member budget exceeded')
      }
      return { kind: 'reject' as const }
    }
    return undefined
  }

  /** Live fleet view for one wave. */
  private viewOf(wave: WaveState): WaveView {
    return {
      waveId: wave.waveId,
      label: wave.label,
      parentSessionId: wave.parentSessionId,
      closed: wave.closed,
      members: wave.members.map(member => this.viewMember(member)),
    }
  }

  private viewMember(member: MemberState): WaveMemberView {
    return {
      memberId: member.memberId,
      provider: member.spec.provider,
      status: member.status,
      tokensUsed: member.tokensUsed,
      ...(member.spec.role === undefined ? {} : { role: member.spec.role }),
      ...(member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId }),
      ...(member.spec.request.agentOptions?.model === undefined
        ? {}
        : { model: member.spec.request.agentOptions.model }),
      ...(member.diagnostic === undefined ? {} : { diagnostic: member.diagnostic }),
    }
  }

  /** Terminal record with the configured byte cap applied to output and structured. */
  private resultOf(member: MemberState): WaveMemberResult {
    const base = this.viewMember(member)
    const cap = this.config.maxResultBytes
    let truncated = false
    let output: readonly ContentBlock[] = member.result?.output ?? []
    if (contentByteSize(output) > cap) {
      let remaining = cap
      output = output.map((block): ContentBlock => {
        if (block.type !== 'text' || remaining <= 0) {
          if (block.type === 'text') truncated = true
          return block.type === 'text' ? { type: 'text', text: '' } : block
        }
        const size = Buffer.byteLength(block.text, 'utf8')
        if (size <= remaining) {
          remaining -= size
          return block
        }
        truncated = true
        const text = truncateUtf8(block.text, remaining)
        remaining = 0
        return { type: 'text', text }
      })
    }
    const structured = member.result?.structured
    let keptStructured = true
    if (structured !== undefined) {
      let size = 0
      try {
        size = Buffer.byteLength(JSON.stringify(structured), 'utf8')
      } catch {
        size = Number.POSITIVE_INFINITY
      }
      if (size > cap) {
        keptStructured = false
        truncated = true
      }
    }
    return {
      ...base,
      output,
      truncated,
      ...(keptStructured && structured !== undefined ? { structured } : {}),
      ...(member.result?.stopReason === undefined ? {} : { stopReason: member.result.stopReason }),
    }
  }
}

export default WaveRuntime
