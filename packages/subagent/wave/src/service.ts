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
import { SessionLogOffset } from '@greeneek/gnk-session'
import type { SessionId } from '@greeneek/gnk-session'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { z as zod } from 'zod'
import { validateArtifacts } from './artifacts.ts'
import { WaveError } from './error.ts'
import { Semaphore } from './semaphore.ts'
import type { SubagentResult, SubagentRun } from '@greeneek/gnk-subagent'
import type {
  ResolvedWaveConfig,
  WaveArtifactPointer,
  WaveId,
  WaveMemberId,
  WaveMemberResult,
  WaveMemberSpec,
  WaveMemberStatus,
  WaveMemberView,
  WaveRequest,
  WaveResult,
  WaveResultEnvelope,
  WaveResumeBudgets,
  WaveRuntimeConfig,
  WaveView,
} from './types.ts'
import { WaveId as WaveIdBrand, WaveMemberId as WaveMemberIdBrand } from './types.ts'
// Loads the Remote-face failure codes this service throws.
import type {} from './remote-codes.ts'

declare module '@greeneek/cordis' {
  interface Context {
    waves: WaveRuntime
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
  'wave.resume': zod.object({
    waveId: ID_SCHEMA,
    maxTokensPerMember: zod.number().int().positive().optional(),
    maxWaveTokens: zod.number().int().positive().optional(),
  }),
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

/** Wall-clock launch-to-settlement milliseconds; absent until both ends exist. */
function durationOf(member: MemberState): number | undefined {
  return member.startedAtMs === undefined || member.endedAtMs === undefined
    ? undefined
    : member.endedAtMs - member.startedAtMs
}

/**
 * Validated artifact pointers of one member's settled structured result. The
 * structured value is the only pointer origin — prose output is never read —
 * and the engine validates every claim before publishing it, so a member
 * still running (no result yet) contributes none.
 * @param member - the member whose settled result to read.
 * @returns the validated pointers; empty before settlement or when the
 *   structured result names none.
 */
function memberArtifacts(member: MemberState): readonly WaveArtifactPointer[] {
  const structured = member.result?.structured
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) return []
  return validateArtifacts((structured as Record<string, unknown>).artifacts)
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
  /** Cumulative tokens the projection charged to the member budget; absent until metered. */
  budgetUsed: number | undefined
  /** Wall-clock launch time; absent until the member leaves the queue. */
  startedAtMs: number | undefined
  /** Wall-clock settlement time; absent until the member's funnel reaches settlement. */
  endedAtMs: number | undefined
  /** Name of the last `tool/call` the child logged; absent until one is read. */
  lastTool: string | undefined
  /** Child-log position already folded into {@link lastTool}. */
  toolScanOffset: number
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
  /** The wave this one started for its unfinished members; set once at that resume's admission. */
  resumedToWaveId: WaveId | undefined
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
    this.validateAdmission(request)
    const { done } = this.admitWave(request)
    return done
  }

  /**
   * Resume one closed budget-interrupted wave: admit a new wave carrying only
   * the members that did not complete, with their original specs and dispatch
   * order, under the caller's new explicit token budgets. Completed members
   * never rerun, and one wave resumes at most once — the resumed-from mark is
   * published at the new wave's admission, so a repeated call while the new
   * wave runs rejects instead of starting a second one.
   * @param waveId - the interrupted wave to resume.
   * @param budgets - the new explicit token ceilings; at least one is required.
   * @returns the resumed wave's settlement, like {@link startWave}.
   * @throws {@link WaveError} `WAVE_NOT_FOUND` for an unretained id and
   *   `WAVE_NOT_RESUMABLE` when the wave is not closed, never lost a member
   *   to a budget kill, was already resumed, or carries no explicit budget;
   *   provider and meter checks ride {@link startWave}.
   */
  async resumeWave(waveId: WaveId, budgets: WaveResumeBudgets): Promise<WaveResult> {
    const { done } = this.resumeAdmission(waveId, budgets)
    return done
  }

  /**
   * Validate one resume, admit the linked wave, and publish the source's
   * resumed-from mark. Entirely synchronous, so two concurrent resumes of one
   * wave cannot interleave: the second sees the mark the first set.
   * @param waveId - the interrupted wave to resume.
   * @param budgets - the new explicit token ceilings; at least one is required.
   * @returns the new wave's id and its settlement promise.
   * @throws {@link WaveError} `WAVE_NOT_FOUND` for an unretained id,
   *   `WAVE_NOT_RESUMABLE` when the wave is not closed, never lost a member
   *   to a budget kill, was already resumed, or carries no explicit budget.
   */
  private resumeAdmission(waveId: WaveId, budgets: WaveResumeBudgets): { resumedId: WaveId; done: Promise<WaveResult> } {
    const source = this.waves.get(waveId)
    if (source === undefined) throw new WaveError(`no wave "${String(waveId)}" is retained`, 'WAVE_NOT_FOUND')
    if (!source.closed || source.resumedToWaveId !== undefined) {
      throw new WaveError(
        source.resumedToWaveId !== undefined
          ? `wave "${String(waveId)}" was already resumed`
          : `wave "${String(waveId)}" is not closed`,
        'WAVE_NOT_RESUMABLE',
      )
    }
    if (!source.members.some(member => member.budgetKilled)) {
      throw new WaveError(`wave "${String(waveId)}" lost no member to a budget kill`, 'WAVE_NOT_RESUMABLE')
    }
    if (budgets.maxTokensPerMember === undefined && budgets.maxWaveTokens === undefined) {
      throw new WaveError('resuming requires an explicit token budget', 'WAVE_NOT_RESUMABLE')
    }
    const pending = source.members.filter(member => member.status !== 'completed')
    // The resumed wave's budgets are exactly the caller's: an unset ceiling is
    // omitted, never inherited from the source, so a resume cannot re-kill
    // members under the ceiling that interrupted them.
    const request: WaveRequest = {
      parent: source.request.parent,
      label: source.request.label,
      members: pending.map(member => member.spec),
      ...(source.request.onComplete === undefined ? {} : { onComplete: source.request.onComplete }),
      ...(budgets.maxTokensPerMember === undefined ? {} : { maxTokensPerMember: budgets.maxTokensPerMember }),
      ...(budgets.maxWaveTokens === undefined ? {} : { maxWaveTokens: budgets.maxWaveTokens }),
      resumedFromWaveId: waveId,
    }
    this.validateAdmission(request)
    const { waveId: resumedId, done } = this.admitWave(request)
    // Admission is the commit point: the source's resumable mark publishes
    // only after the new wave's admission record is written and its members
    // launched.
    source.resumedToWaveId = resumedId
    return { resumedId, done }
  }

  /**
   * Check one request against the live registry and budget meter before any
   * state is built.
   * @param request - the request to admit.
   * @throws {@link WaveError} `EMPTY_WAVE`, `NO_PROVIDER`, or
   *   `BUDGET_METER_UNAVAILABLE`.
   */
  private validateAdmission(request: WaveRequest): void {
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
  }

  /**
   * Build the wave's state, write its durable admission record, and launch
   * every member. Purely synchronous, so an admission is never interleaved
   * with another.
   * @param request - a request {@link validateAdmission} already accepted.
   * @returns the minted wave id and the wave's settlement promise.
   */
  private admitWave(request: WaveRequest): { waveId: WaveId; done: Promise<WaveResult> } {
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
      budgetUsed: undefined,
      startedAtMs: undefined,
      endedAtMs: undefined,
      lastTool: undefined,
      toolScanOffset: 0,
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
      resumedToWaveId: undefined,
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
    return { waveId, done }
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

  /**
   * Remote face of {@link resumeWave}: admit a new wave for the addressed
   * wave's unfinished members under fresh explicit budgets. Ineligible waves
   * surface as the typed `wave/not-resumable` code instead of host throws.
   * @param waveId - the interrupted wave to resume.
   * @param maxTokensPerMember - the resumed wave's per-member ceiling.
   * @param maxWaveTokens - the resumed wave's aggregate ceiling.
   * @returns the resumed wave's id.
   */
  @Remote('resume')
  remoteResumeWave(waveId: WaveId, maxTokensPerMember?: number, maxWaveTokens?: number): { waveId: string } {
    validateControlRequest('wave.resume', { waveId, maxTokensPerMember, maxWaveTokens })
    try {
      // The answer is the admission, not the settlement: the resumed wave's
      // progress reaches the browser through the list face the mirror polls.
      return {
        waveId: String(this.resumeAdmission(waveId, {
          ...(maxTokensPerMember === undefined ? {} : { maxTokensPerMember }),
          ...(maxWaveTokens === undefined ? {} : { maxWaveTokens }),
        }).resumedId),
      }
    } catch (error: unknown) {
      throw new RemoteError(this.remoteErrorCode(error), 'wave resume failed', { waveId }, { cause: error })
    }
  }

  /** Map a host WaveError onto a stable browser code. */
  private remoteErrorCode(error: unknown): 'wave/not-found' | 'wave/member-not-found' | 'wave/not-resumable' | 'gateway/internal' {
    if (error instanceof WaveError && error.code === 'WAVE_NOT_FOUND') return 'wave/not-found'
    if (error instanceof WaveError && error.code === 'MEMBER_NOT_FOUND') return 'wave/member-not-found'
    if (error instanceof WaveError && error.code === 'WAVE_NOT_RESUMABLE') return 'wave/not-resumable'
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
      member.startedAtMs = Date.now()
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
      // The child's log is the only record of the tools it called, and disposal
      // detaches it, so the last name is folded before the run is disposed.
      this.refreshLastTool(member)
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
    // The funnel is the member's terminal boundary, including a member whose
    // wave already closed while it waited for child disposal.
    this.stampSettledAt(member)
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

  /**
   * Stamp the member's wall-clock settlement time, once. A member whose clock
   * the wave's close stamps first keeps that time, so the durable record and
   * every later view report one duration.
   * @param member - the member reaching a terminal status.
   */
  private stampSettledAt(member: MemberState): void {
    member.endedAtMs ??= Date.now()
  }

  /** Build terminal records, write remaining member records plus the closing record, and resolve {@link startWave}. */
  private closeWave(wave: WaveState): void {
    wave.closed = true
    // A member still awaiting its child's disposal at close time gets its
    // durable record here; its funnel arrives after the close and writes
    // nothing more, so no member is recorded twice and none is missed.
    for (const member of wave.members) {
      this.stampSettledAt(member)
      this.appendMemberSettled(wave, member)
    }
    const results: WaveMemberResult[] = wave.members.map(member => this.resultOf(wave, member))
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
    durationMs?: number
    diagnostic?: string
    artifacts?: readonly WaveArtifactPointer[]
  } {
    const durationMs = durationOf(member)
    const artifacts = memberArtifacts(member)
    return {
      memberId: String(member.memberId),
      memberIndex: member.index,
      // runMember settles only past the terminal status assignment, and
      // closeWave runs only after the open check, so the status is terminal.
      status: member.status as TerminalWaveMemberStatus,
      tokensUsed: member.tokensUsed,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(member.diagnostic === undefined ? {} : { diagnostic: member.diagnostic }),
      ...(artifacts.length === 0 ? {} : { artifacts }),
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
      ...(wave.request.resumedFromWaveId === undefined
        ? {}
        : { resumedFromWaveId: String(wave.request.resumedFromWaveId) }),
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
    member.budgetUsed = tokens
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

  /**
   * Fold the `tool/call` names the member's child logged into its view state.
   * The child session owns that record, so each call reads only the events past
   * the member's cursor. A child session this process does not hold — a remote
   * provider's, or one already disposed — leaves the last name in place.
   * @param member - the member whose child log to read.
   */
  private refreshLastTool(member: MemberState): void {
    if (member.childSessionId === undefined) return
    const child = this.ctx.get('sessions')?.get(member.childSessionId)
    if (child === undefined || child.seq <= member.toolScanOffset) return
    for (const event of child.snapshotEvents(SessionLogOffset(member.toolScanOffset), child.seq)) {
      if (event.type === 'tool/call') member.lastTool = event.data.name
    }
    member.toolScanOffset = child.seq
  }

  /** Live fleet view for one wave, with each row's child log folded up to now. */
  private viewOf(wave: WaveState): WaveView {
    return {
      waveId: wave.waveId,
      label: wave.label,
      parentSessionId: wave.parentSessionId,
      closed: wave.closed,
      ...(wave.resumedToWaveId === undefined ? {} : { resumedToWaveId: wave.resumedToWaveId }),
      members: wave.members.map((member) => {
        this.refreshLastTool(member)
        return this.viewMember(wave, member)
      }),
    }
  }

  /**
   * One member row derived from the engine's state and the wave's budgets.
   * @param wave - the owning wave, which carries the per-member ceiling.
   * @param member - the member to render.
   * @returns the browser-safe row.
   */
  private viewMember(wave: WaveState, member: MemberState): WaveMemberView {
    const durationMs = durationOf(member)
    const budgetLimit = wave.request.maxTokensPerMember
    const artifacts = memberArtifacts(member)
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
      ...(member.lastTool === undefined ? {} : { lastTool: member.lastTool }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(member.budgetUsed === undefined ? {} : { budgetUsed: member.budgetUsed }),
      ...(budgetLimit === undefined ? {} : { budgetLimit }),
      ...(artifacts.length === 0 ? {} : { artifacts }),
    }
  }

  /** Terminal record: capped payload beside the engine's versioned seal. */
  private resultOf(wave: WaveState, member: MemberState): WaveMemberResult {
    const base = this.viewMember(wave, member)
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
    const artifacts = base.artifacts
    const envelope: WaveResultEnvelope = {
      schemaVersion: 1,
      // resultOf is the seal operation itself; the stamp is the seal's clock.
      heartbeatAt: Date.now(),
      truncated,
      ...(member.result?.stopReason === undefined ? {} : { stopReason: member.result.stopReason }),
      ...(artifacts === undefined ? {} : { artifacts }),
    }
    return {
      ...base,
      output,
      envelope,
      ...(keptStructured && structured !== undefined ? { structured } : {}),
    }
  }
}

export default WaveRuntime
