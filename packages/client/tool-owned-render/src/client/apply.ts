/**
 * Registers the tool-owned render views into `tool.call.toolview`.
 * Each entry is keyed by its wire tool name and reuses the
 * `conversation` locale namespace owned by `ui-conversation`.
 */
import type { Context } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import { BashRow, MutationRow, ReadImageRow, ReadRow, SearchRow, WebRow } from './toolviews.tsx'

const NS = 'conversation'

/** Services required by the tool-owned render plugin. */
export const inject = ['slots']

/**
 * Mount the owned tool views.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: NS }, ReadRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'read_image', locale: NS }, ReadImageRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, MutationRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, MutationRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'glob', locale: NS }, SearchRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_search', locale: NS }, SearchRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_fetch', locale: NS }, WebRow)
  })
}
