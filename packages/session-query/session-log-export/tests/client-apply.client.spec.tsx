import { Context } from '@greeneek/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@greeneek/gnk-client-ui-renderer/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import { LocaleRuntime } from '@greeneek/gnk-client-locale/client'
import type {} from '@greeneek/gnk-client-ui-chat/client'
import { SessionExportActions } from '../src/client/DetailsActions.tsx'
import { apply, inject } from '../src/client/index.ts'

const SID = 'session-export-apply' as SessionId

afterEach(() => { vi.unstubAllGlobals() })

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.details.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber }
}

describe('session-log-download browser plugin', () => {
  it('provides both export controllers and removes its Thread Details contribution on disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const b = await bench()
    expect(inject).toEqual(['slots', 'locale'])
    expect(b.ctx.sessionLogDownload).toBeDefined()
    expect(b.ctx.sessionMarkdownCopy).toBeDefined()
    // The Session Header carries no duplicate menu for the export verbs.
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    const entry = b.slots.entries('conversation.details.actions')[0]
    expect(entry?.component).toBe(SessionExportActions)
    expect(entry?.options).toMatchObject({ id: 'session-export' })
    const injected = (entry?.inject as unknown as () => import('../src/client/DetailsActions.tsx').SessionExportActionsInjected)()
    await injected.request(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    injected.dismiss(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.open).toBe(false)

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.details.actions')).toHaveLength(0)
  })

  it('downloads only for an export execution acknowledged by this browser client', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const first = await bench()
    const second = await bench()

    expect(first.ctx.sessionLogDownload).not.toBe(second.ctx.sessionLogDownload)
    expect(first.ctx.sessionMarkdownCopy).not.toBe(second.ctx.sessionMarkdownCopy)
    await first.fiber.dispose()
    await second.fiber.dispose()
  })
})
