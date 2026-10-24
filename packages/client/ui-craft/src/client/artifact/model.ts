/**
 * Artifact card model — a replay-stable projection of one Craft bridge call.
 *
 * The bridge renders every result as text blocks plus an optional trailing
 * `Artifacts:` section (one confined path per line). The card only reads that
 * durable slice: no live catalog lookup, no filesystem access. Paths arrive
 * already confined to the job `out/` root by the Host.
 */
import type { ToolCallViewProps } from '@greeneek/gnk-client-ui-tool/client'

/** Card lifecycle derived solely from the durable call slice. */
export type CraftArtifactState = 'running' | 'ok' | 'error'

/** Compact view model for the artifact card. */
export interface CraftArtifactModel {
  /** Running until the result settles; error when the bridge reported a failure. */
  readonly state: CraftArtifactState
  /** Confined artifact paths in result order. */
  readonly artifacts: readonly string[]
  /** First line of the app's own text, when it said anything. */
  readonly summary: string | null
}

/** Section heading the Host's `renderCallText` appends before artifact paths. */
const ARTIFACT_MARKER = 'Artifacts:'

/**
 * Flatten durable result blocks under the generic Tool-row text contract.
 * Keep aligned with ui-tool's models/tool-call-model.ts `resultText`.
 * @param block - running call or settled result node.
 * @returns joined text, or null when the block carries none.
 */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/**
 * Split one rendered result into its prose body and artifact paths.
 * @param text - full model-facing result text.
 * @returns the text before the marker and the trimmed paths after it.
 */
function splitArtifacts(text: string): { readonly body: string; readonly artifacts: readonly string[] } {
  const lines = text.split('\n')
  const index = lines.findIndex(line => line.trim() === ARTIFACT_MARKER)
  if (index === -1) return { body: text, artifacts: [] }
  const artifacts = lines.slice(index + 1)
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => line.startsWith('- ') ? line.slice(2).trim() : line)
  return { body: lines.slice(0, index).join('\n'), artifacts }
}

/**
 * Take the last path segment of a Host path (POSIX or Windows separators).
 * @param path - absolute or relative artifact path.
 * @returns the file name used as the chip text.
 */
export function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * Parse the artifact paths out of one rendered bridge result.
 * @param text - full model-facing result text.
 * @returns trimmed artifact paths in result order.
 */
export function parseArtifactPaths(text: string): readonly string[] {
  return splitArtifacts(text).artifacts
}

/**
 * Derive the card's state, artifact list, and summary.
 * @param block - running call or settled result node.
 * @returns the replay-stable card model.
 */
export function artifactModel(block: ToolCallViewProps['block']): CraftArtifactModel {
  const settled = 'kind' in block
  const text = resultText(block)
  const split = text === null ? { body: '', artifacts: [] } : splitArtifacts(text)
  const body = split.body.trim()
  const newline = body.indexOf('\n')
  const firstLine = newline === -1 ? body : body.slice(0, newline)
  const state: CraftArtifactState = !settled
    ? 'running'
    : block.isError ? 'error' : 'ok'
  return {
    state,
    artifacts: settled ? split.artifacts : [],
    summary: firstLine === '' ? null : firstLine,
  }
}
