/**
 * Artifact confinement and model-facing projection for one app call.
 *
 * Every path the app reports is resolved against the job write root; an escape
 * fails the call instead of exposing a path outside the job.
 * @module @greeneek/gnk-tool-craft/artifacts
 */

import { confineArtifact } from '@greeneek/gnk-craft'
import type { CraftCallResult, CraftRoots } from '@greeneek/gnk-craft'
import type { JsonValue } from '@greeneek/gnk-util-values'
import type { CraftProjectedCall } from './types.ts'

/**
 * Confine one app result and render its model-facing text.
 * @param result - transport projection of one call.
 * @param roots - confined job roots.
 * @returns ordered content, confined artifact paths, and text.
 */
export function projectCallResult(result: CraftCallResult, roots: CraftRoots): CraftProjectedCall {
  const artifacts = (result.artifacts ?? []).map(artifact => confineArtifact(roots, artifact))
  const content = result.content as unknown as readonly JsonValue[]
  return { content, artifacts, text: renderCallText(content, artifacts) }
}

/**
 * Render one result for the model: text blocks first, then the artifact list.
 * @param content - ordered content blocks.
 * @param artifacts - confined artifact paths.
 * @returns the model-facing text, or a placeholder when the app said nothing.
 */
export function renderCallText(content: readonly JsonValue[], artifacts: readonly string[]): string {
  const parts = content.map((block) => {
    if (typeof block === 'object' && block !== null && !Array.isArray(block)) {
      const record = block as { readonly text?: unknown; readonly type?: unknown }
      if (typeof record.text === 'string') return record.text
      return `[${typeof record.type === 'string' ? record.type : 'unknown'} content]`
    }
    return '[unsupported app content block]'
  })
  const body = parts.join('\n')
  const artifactText = artifacts.length === 0
    ? ''
    : `${body === '' ? '' : '\n\n'}Artifacts:\n${artifacts.join('\n')}`
  const text = `${body}${artifactText}`
  return text === '' ? '(no output)' : text
}
