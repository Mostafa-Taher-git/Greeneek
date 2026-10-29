/**
 * Engine-owned validation of wave artifact pointers. A member's structured
 * result may name artifacts under its reserved `artifacts` property; this
 * module is the single gate that decides which of those claims are published
 * as {@link WaveArtifactPointer}s — never the child's prose output.
 *
 * Validation is total: every malformed claim is dropped rather than thrown,
 * because the claims are child-authored data, and the member's raw structured
 * value stays available to the Lead beside the vetted pointers.
 *
 * @module @greeneek/gnk-subagent-wave/artifacts
 */

import type { WaveArtifactPointer } from './views.ts'

/**
 * Maximum pointers promoted from one member's settled result, matching the
 * wave engine's member-count bound: one artifact per fleet member is the
 * scale the fleet surfaces render.
 */
export const MAX_WAVE_ARTIFACTS = 16

/** UTF-8 byte ceiling for one `file` pointer's path. */
const MAX_PATH_BYTES = 1024

/** Character ceiling for one `uri` pointer's URI. */
const MAX_URI_CHARS = 2048

/** Control characters (C0 and DEL) a path or URI must not carry. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/

/** The keys a pointer entry may carry, by kind. */
const POINTER_KEYS: Record<WaveArtifactPointer['kind'], readonly string[]> = {
  file: ['kind', 'path'],
  uri: ['kind', 'uri'],
}

/**
 * Whether one raw entry is a plain object whose keys are exactly its kind's
 * allowed set.
 * @param entry - the raw artifacts-array entry.
 * @returns true when the entry is a closed pointer-shaped object.
 */
function isPointerShaped(entry: unknown): entry is Record<string, unknown> {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
  const candidate = entry as Record<string, unknown>
  const kind = candidate.kind
  if (kind !== 'file' && kind !== 'uri') return false
  const allowed = POINTER_KEYS[kind]
  const keys = Object.keys(candidate)
  return keys.length === allowed.length && keys.every(key => allowed.includes(key))
}

/**
 * Validate one raw `file` pointer claim.
 * @param path - the claimed path value.
 * @returns the pointer, or `undefined` when the claim is out of bounds.
 */
function filePointer(path: unknown): WaveArtifactPointer | undefined {
  if (typeof path !== 'string' || path.length === 0) return undefined
  if (Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES) return undefined
  if (CONTROL_CHARS.test(path)) return undefined
  return { kind: 'file', path }
}

/**
 * Validate one raw `uri` pointer claim. Only HTTP(S) URIs are promoted: the
 * fleet surfaces render pointers as openable web locations, and other schemes
 * duplicate the `file` kind or name non-renderable targets.
 * @param uri - the claimed URI value.
 * @returns the pointer, or `undefined` when the claim is out of bounds.
 */
function uriPointer(uri: unknown): WaveArtifactPointer | undefined {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_CHARS) return undefined
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return { kind: 'uri', uri }
}

/**
 * Promote the valid pointer claims of one member's structured result, in the
 * child's order, up to {@link MAX_WAVE_ARTIFACTS}. Malformed entries, missing
 * values, out-of-bounds paths and URIs, and non-HTTP(S) schemes are dropped;
 * the function never throws and never reads anything but the value it is
 * handed.
 * @param raw - the structured result's raw `artifacts` value.
 * @returns the validated pointers; empty when the value carries none.
 */
export function validateArtifacts(raw: unknown): readonly WaveArtifactPointer[] {
  if (!Array.isArray(raw)) return []
  const pointers: WaveArtifactPointer[] = []
  for (const entry of raw) {
    if (pointers.length >= MAX_WAVE_ARTIFACTS) break
    if (!isPointerShaped(entry)) continue
    if (entry.kind === 'file') {
      const pointer = filePointer(entry.path)
      if (pointer !== undefined) pointers.push(pointer)
    } else {
      const pointer = uriPointer(entry.uri)
      if (pointer !== undefined) pointers.push(pointer)
    }
    // A dropped claim leaves the remaining entries to be judged on their own;
    // no pointer is invented for a rejected entry.
  }
  return pointers
}
