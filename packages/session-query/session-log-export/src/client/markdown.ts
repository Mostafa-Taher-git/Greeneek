/**
 * Markdown transcript of one Session's durable events.
 *
 * The export reads the durable log, not the rendered transcript: what the user
 * said, what the model answered, and what each tool returned, in the order the
 * Session recorded them. A Session that has not produced an answer yet still
 * exports its own heading, so the copy is always a usable document.
 */
import type { SessionEvent } from '@greeneek/gnk-session/types'

/** The facts a Markdown transcript header carries. */
export interface SessionMarkdownHeader {
  /** The Session's display title; the export names the document after it. */
  readonly title?: string
  /** The Session's workspace directory, recorded as the document's origin. */
  readonly cwd?: string
}

/** The headings the exported document uses; the caller owns the wording. */
export interface SessionMarkdownLabels {
  readonly user: string
  readonly assistant: string
  readonly tool: string
  readonly result: string
}

/** The maximum tool output a transcript carries, so one noisy result cannot flood the copy. */
const TOOL_OUTPUT_LIMIT = 4_000

/** One tool call's name, so its result reads under the right heading. */
interface ToolCallName {
  readonly callId: string
  readonly name: string
}

/** Concatenate the plain-text blocks of one message. */
function textOf(blocks: readonly { type: string }[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('')
}

/** The tool-result text of one result message, in block order. */
function toolResultText(blocks: readonly { type: string }[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type !== 'tool-result' || !('content' in block)) continue
    const inner = (block as { content: readonly { type: string }[] }).content
    parts.push(textOf(inner))
  }
  return parts.filter(part => part !== '').join('\n')
}

/**
 * Build the Markdown transcript of one Session.
 * @param events - the Session's durable events, in log order.
 * @param header - the document's title and workspace directory.
 * @param labels - the headings the document uses.
 * @returns the Markdown document.
 */
export function sessionMarkdown(
  events: readonly SessionEvent[],
  header: SessionMarkdownHeader,
  labels: SessionMarkdownLabels,
): string {
  const title = header.title?.trim() ?? ''
  const lines: string[] = [`# ${title === '' ? 'Session' : title}`]
  if (header.cwd !== undefined && header.cwd !== '') {
    lines.push('', `Workspace: \`${header.cwd}\``)
  }
  const calls: ToolCallName[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      // Injected context (skills, notices, file mentions) is not the user's
      // own message and does not belong in a transcript of the conversation.
      if (event.data.source.kind !== 'user') continue
      const text = textOf(event.data.content)
      if (text.trim() === '') continue
      lines.push('', `## ${labels.user}`, '', text)
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data.message.content)
      if (text.trim() === '') continue
      lines.push('', `## ${labels.assistant}`, '', text)
      continue
    }
    if (event.type === 'tool/call') {
      calls.push({ callId: String(event.data.callId), name: event.data.name })
      lines.push('', `### ${labels.tool}: ${event.data.name}`, '', '```json', event.data.arguments, '```')
      continue
    }
    if (event.type === 'tool/result') {
      const text = toolResultText(event.data.message.content)
      if (text.trim() === '') continue
      const callId = String(event.data.message.source.callId)
      const name = calls.find(call => call.callId === callId)?.name
      const heading = name === undefined ? `### ${labels.result}` : `### ${labels.result}: ${name}`
      const body = text.length > TOOL_OUTPUT_LIMIT
        ? `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n\n… (truncated)`
        : text
      lines.push('', heading, '', body)
    }
  }
  return `${lines.join('\n')}\n`
}
