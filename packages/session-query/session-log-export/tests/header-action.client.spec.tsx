// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@greeneek/gnk-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId

function bindSessionExport(controller: SessionLogDownloadController) {
  return function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
}

function bench(activeView: string | null = 'chat') {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const selectView = vi.fn((_view: string) => undefined)
  const useSessionLogDownload = bindSessionExport(controller)
  const props = {
    sessionId: SID,
    useSessionLogDownload,
    request,
    dismiss,
    selectView,
    activeView,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogDownloadDialogProps
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, selectView, view }
}

function openMenu(view: ReturnType<typeof render>): void {
  fireEvent.click(view.getByRole('button', { name: 'Session options' }))
}

afterEach(cleanup)

describe('Session Header kebab menu', () => {
  it('renders the icon-only button with the menu closed', () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'Session options' })
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('switches to the trajectory view and closes the menu', () => {
    const b = bench()
    openMenu(b.view)
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Trajectory' }))
    expect(b.selectView).toHaveBeenCalledWith('trajectory')
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('names the view item Chat while the trajectory view is active', () => {
    const b = bench('trajectory')
    openMenu(b.view)
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Chat' }))
    expect(b.selectView).toHaveBeenCalledWith('chat')
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('exports through the shared controller and closes the menu', async () => {
    const b = bench()
    openMenu(b.view)
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Session log' }))
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(b.view.queryByRole('menu')).toBeNull()
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('closes on Escape and on outside pointer-down', () => {
    const b = bench()
    openMenu(b.view)
    expect(b.view.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('menu')).toBeNull()

    openMenu(b.view)
    expect(b.view.getByRole('menu')).toBeTruthy()
    fireEvent(document, new window.Event('pointerdown', { bubbles: true }))
    expect(b.view.queryByRole('menu')).toBeNull()
  })
})
