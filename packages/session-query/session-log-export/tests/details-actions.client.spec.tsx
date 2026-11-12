// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@greeneek/gnk-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionMarkdownCopyController } from '../src/client/markdown-controller.ts'
import { SessionExportActions } from '../src/client/DetailsActions.tsx'
import type { SessionExportActionsProps } from '../src/client/DetailsActions.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-details' as SessionId

function bind<T>(store: { subscribe: (listener: () => void) => () => void; getSnapshot: () => T }) {
  return function useBound(selector: (state: T) => unknown): unknown {
    return useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
    )
  }
}

function bench(copyMarkdown = vi.fn(async () => undefined)) {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const markdown = new SessionMarkdownCopyController(async () => new Response('zip'), vi.fn(async () => true))
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const clearCopy = vi.fn((sessionId: SessionId) => { markdown.clear(sessionId) })
  const props = {
    sessionId: SID,
    useSessions: (selector: (state: { byId: Record<string, { title: string }> }) => unknown) => selector({
      byId: { [SID]: { title: 'Release notes' } },
    }),
    useSessionLogDownload: bind(controller.store),
    useSessionMarkdownCopy: bind(markdown.store),
    request,
    dismiss,
    copyMarkdown,
    clearCopy,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionExportActionsProps
  const view = render(<SessionExportActions {...props} />)
  return { controller, markdown, request, copyMarkdown, clearCopy, view }
}

afterEach(cleanup)

describe('Thread Details export actions', () => {
  it('offers the transcript copy and the log download', () => {
    const b = bench()
    expect(b.view.getByRole('button', { name: 'Copy Session as Markdown' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: 'Download session log' })).toBeTruthy()
  })

  it('copies the Session as Markdown with its title', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'Copy Session as Markdown' }))
    expect(b.copyMarkdown).toHaveBeenCalledWith(SID, 'Release notes')
  })

  it('requests the log download', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'Download session log' }))
    expect(b.request).toHaveBeenCalledWith(SID)
  })
})
