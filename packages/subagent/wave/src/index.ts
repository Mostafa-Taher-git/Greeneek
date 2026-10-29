/**
 * Service Definition for the Army wave engine (`ctx.waves`): one Lead agent
 * admits a {@link WaveRequest}, the engine launches its members concurrently
 * under a shared cap through the subagent seam, meters per-member and
 * per-wave token budgets at `agent/pre-step`, owns cancellation, and settles
 * deterministic spec-order results.
 *
 * This package is the wave Consumer of the subagent capability seam and the
 * browser `@Remote` face of fleet control; the Lead-facing tool Consumer and
 * the fleet UI mount it separately.
 *
 * @module @greeneek/gnk-subagent-wave
 */

export { WaveError } from './error.ts'
export type { WaveErrorCode } from './error.ts'
export {
  Config,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_RESULT_BYTES,
  MAX_CONCURRENT_CEILING,
  MAX_RESULT_BYTES_CEILING,
  WaveRuntime,
} from './service.ts'
export type {
  ResolvedWaveConfig,
  WaveArtifactPointer,
  WaveMemberRequest,
  WaveMemberResult,
  WaveMemberSpec,
  WaveMemberStatus,
  WaveMemberView,
  WaveRequest,
  WaveResumeBudgets,
  WaveResult,
  WaveResultEnvelope,
  WaveRuntimeConfig,
  WaveView,
} from './types.ts'
export { WaveId, WaveMemberId } from './types.ts'
export { WaveRuntime as default } from './service.ts'
