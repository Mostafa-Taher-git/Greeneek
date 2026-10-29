import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore, ChatSnapshot, ToolCallBlock } from '../contract/snapshot.ts'

/**
 * The dispatch tool a Lead starts a wave with. Its presence in the loaded
 * window is how the details panel knows this session's fleet is active —
 * slot occupancy cannot express per-session activity.
 */
export const WAVE_DISPATCH_TOOL = 'wave_dispatch'

function toolNode(node: ReturnType<ChatNodeStore['get']>): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

/**
 * Find any root or nested Tool lifecycle through the internal Node store.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns current Tool lifecycle when materialized in the loaded window.
 */
export function findToolCall(snapshot: ChatSnapshot, callId: string): ToolCallBlock | undefined {
  const visit = (block: ToolCallBlock): ToolCallBlock | undefined => {
    if (block.callId === callId) return block
    for (const child of block.subCalls) {
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const node of snapshot.nodes.values()) {
    const root = toolNode(node)?.data.root
    if (root === undefined) continue
    const found = visit(root)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Whether any root or nested Tool call in the loaded window carries the name —
 * a dispatch mid-flight counts as much as a settled one.
 * @param snapshot - current Conversation snapshot.
 * @param name - the tool name to look for.
 * @returns true when at least one call in the window uses the name.
 */
export function hasToolCall(snapshot: ChatSnapshot, name: string): boolean {
  const visit = (block: ToolCallBlock): boolean => {
    if (('kind' in block ? block.call?.name : block.name) === name) return true
    return block.subCalls.some(visit)
  }
  for (const node of snapshot.nodes.values()) {
    const root = toolNode(node)?.data.root
    if (root !== undefined && visit(root)) return true
  }
  return false
}
