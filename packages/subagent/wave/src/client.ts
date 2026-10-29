/**
 * Browser-safe wave vocabulary: ids, member statuses, and live fleet views.
 *
 * Settled member results stay out of this face: they carry the child's output
 * blocks and the seam's stop reason, which belong to the Lead's context rather
 * than to any surface.
 * @module @greeneek/gnk-subagent-wave/client
 */

/** Loads the wave views and the Remote-face failure codes for browser consumers. */
export type {} from './remote-codes.ts'

export type {
  WaveArtifactPointer,
  WaveId,
  WaveMemberId,
  WaveMemberStatus,
  WaveMemberView,
  WaveView,
} from './views.ts'
