/**
 * Pure derivation for tool-owned render registrants from current
 * `ToolCallBlock` fields (`block.name`/`block.argsRaw` while running,
 * `block.call`/`block.content`/`block.meta` once settled). No host
 * `presentResult` values enter the client.
 */
import type { ToolCallBlock, ToolResultNode } from '@greeneek/gnk-client-ui-chat/client'

export type { ToolCallBlock } from '@greeneek/gnk-client-ui-chat/client'

/** Locale title key per owned tool (owned by `ui-conversation`). */
export type OwnedTitleKey =
  | 'tool.title.read'
  | 'tool.title.readImage'
  | 'tool.title.bash'
  | 'tool.title.write'
  | 'tool.title.edit'
  | 'tool.title.grep'
  | 'tool.title.glob'
  | 'tool.title.webSearch'
  | 'tool.title.webFetch'

/** Lifecycle state of one owned tool call. */
export type OwnedState = 'running' | 'ok' | 'error' | 'stopped'

/** The presentation a tool-owned renderer receives. */
export interface OwnedModel {
  titleKey: OwnedTitleKey
  summary: string
  output: string | null
  state: OwnedState
}

const TITLE_KEYS: Readonly<Record<string, OwnedTitleKey>> = {
  read: 'tool.title.read',
  read_image: 'tool.title.readImage',
  bash: 'tool.title.bash',
  write: 'tool.title.write',
  edit: 'tool.title.edit',
  grep: 'tool.title.grep',
  glob: 'tool.title.glob',
  web_search: 'tool.title.webSearch',
  web_fetch: 'tool.title.webFetch',
}

const SUMMARY_KEYS: Readonly<Record<string, readonly string[]>> = {
  read: ['path', 'file_path'],
  read_image: ['path', 'file_path'],
  bash: ['command', 'description'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  grep: ['pattern', 'query', 'path'],
  glob: ['pattern', 'query', 'path'],
  web_search: ['query', 'queries'],
  web_fetch: ['url', 'path'],
}

/* jscpd:ignore-start -- the tool-call derivation is mirrored deliberately: the
   owner-render package and the tool panel each derive the presentation from
   the call blocks, and neither client feature package may import the other's
   values (packages/client/AGENTS.md). */
/**
 * Flatten a settled result's content blocks to display text.
 * @param node - the settled result node.
 * @returns the flattened result text (may be empty).
 */
export function resultText(node: ToolResultNode): string {
  const parts: string[] = []
  for (const block of node.content) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.join('\n')
}

function parseArgs(argsRaw: string): unknown {
  try {
    return JSON.parse(argsRaw)
  } catch {
    return undefined
  }
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = args[key]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

function argsRawOf(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}
/* jscpd:ignore-end */

function summaryOf(toolName: string, argsRaw: string, callId: string): string {
  if (argsRaw === '') return callId
  const parsed = parseArgs(argsRaw)
  if (typeof parsed !== 'object' || parsed === null) return firstLine(argsRaw)
  const args = parsed as Record<string, unknown>
  if (toolName === 'web_search' && Array.isArray(args.queries)) {
    const queries = args.queries.filter((q): q is string => typeof q === 'string' && q !== '')
    if (queries.length > 0) return firstLine(queries.join(', '))
  }
  const picked = pickString(args, SUMMARY_KEYS[toolName] ?? [])
  if (picked !== undefined) return firstLine(picked)
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v !== '') return firstLine(v)
  }
  return firstLine(argsRaw)
}

function titleKeyOf(toolName: string): OwnedTitleKey {
  const key = TITLE_KEYS[toolName]
  return key ?? 'tool.title.read'
}

function stateOf(block: ToolCallBlock): OwnedState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/**
 * Derive the shared owned-row model from a frozen call slice.
 * @param toolName - wire tool name.
 * @param block - running or settled call block.
 * @returns the owned-row model.
 */
export function deriveModel(toolName: string, block: ToolCallBlock): OwnedModel {
  const argsRaw = argsRawOf(block)
  const summary = summaryOf(toolName, argsRaw, block.callId)
  const output = 'kind' in block ? (resultText(block) || null) : null
  return { titleKey: titleKeyOf(toolName), summary, output, state: stateOf(block) }
}
