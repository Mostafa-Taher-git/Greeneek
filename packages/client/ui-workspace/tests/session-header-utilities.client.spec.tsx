// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import type { SessionListState, SessionSummary } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceSnapshot } from '@greeneek/gnk-api-workspace-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import type { ExternalAppsShare } from '../src/client/contract/slots.ts'
import {
  SessionHeaderUtilities,
  type SessionHeaderUtilitiesProps,
} from '../src/client/SessionHeaderUtilities.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: SessionHeaderUtilitiesProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const summary = (id: string, title: string): SessionSummary => ({
  id: sid(id), displayTitle: title, title, running: false, blank: false, updatedAt: 0,
})

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

const catalogue: ExternalAppsShare = {
  platform: 'linux',
  apps: [{ id: 'cursor', available: true }, { id: 'vscode', available: false }],
  canReveal: true,
}

/** Open the session overflow menu and return one of its rows. */
async function selectAction(name: string): Promise<void> {
  fireEvent.click(screen.getByLabelText('更多会话操作'))
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

function mount(overrides: Partial<SessionHeaderUtilitiesProps> = {}) {
  const sessions: SessionListState = {
    ids: [sid('session')],
    byId: Object.fromEntries([[sid('session'), summary('session', 'Renamed session')]]),
    current: sid('session'),
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaces: WorkspaceSnapshot = {
    items: [],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const props: SessionHeaderUtilitiesProps = {
    sessionId: sid('session'),
    useSession: hook({
      sessionId: sid('session'),
      queue: [],
      pendingSubmissions: [],
      running: false,
      subagent: null,
      removed: false,
      openState: 'open',
      openError: null,
      hasMore: false,
      loadingOlder: false,
      promptError: null,
      blank: false,
      lastAgentError: null,
      promptAttempted: false,
      awaitingFirstTurn: false,
    }),
    useProjection: hook(undefined),
    useConversation: () => { throw new Error('unused by the session header') },
    useInput: () => { throw new Error('unused by the session header') },
    useChat: () => { throw new Error('unused by the session header') },
    useTrajectory: () => { throw new Error('unused by the session header') },
    useSessionPendingInteraction: hook(new Map()),
    inputActions: {
      setDraft: () => {},
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
    useSessions: hook(sessions),
    useWorkspaces: hook(workspaces),
    pinSession: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    forkSession: vi.fn(),
    externalApps: vi.fn(async () => catalogue),
    openPath: vi.fn(async () => {}),
    t,
    ...overrides,
  }
  const view = render(<SessionHeaderUtilities {...props} />)
  return { view, props }
}

describe('SessionHeaderUtilities', () => {
  it('offers the folder opener, pin, archive, and overflow actions', async () => {
    mount()
    // The default-application label names the Host platform once the
    // catalogue arrives.
    await waitFor(() => {
      expect(screen.getByLabelText('文件 (默认)')).toBeTruthy()
    })
    expect(screen.getByLabelText('在外部应用或文件管理器中打开')).toBeTruthy()
    expect(screen.getByLabelText('固定会话')).toBeTruthy()
    expect(screen.getByLabelText('归档会话')).toBeTruthy()
    expect(screen.getByLabelText('更多会话操作')).toBeTruthy()
  })

  it.each([
    ['darwin', '访达 (默认)'],
    ['win32', '文件资源管理器 (默认)'],
    ['aix', '打开工作区文件夹'],
  ] as const)('names the %s file manager', async (platform, label) => {
    mount({ externalApps: vi.fn(async () => ({ ...catalogue, platform })) })
    await waitFor(() => {
      expect(screen.getByLabelText(label)).toBeTruthy()
    })
  })

  it('lists only the applications the Host reports as installed', async () => {
    mount()
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText('Cursor')).toBeTruthy()
    })
    expect(screen.queryByText('VS Code')).toBeNull()
  })

  it.each([
    ['cursor', 'Cursor'],
    ['vscode', 'VS Code'],
    ['android-studio', 'Android Studio'],
    ['github-desktop', 'GitHub Desktop'],
  ] as const)('offers the %s application', async (id, label) => {
    mount({ externalApps: vi.fn(async () => ({
      ...catalogue,
      apps: [{ id, available: true }],
    })) })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText(label)).toBeTruthy()
    })
  })

  it('omits an application the Client has no name for', async () => {
    mount({ externalApps: vi.fn(async () => ({
      ...catalogue,
      apps: [{ id: 'unknown-editor', available: true }],
    })) })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText('文件 (默认)')).toBeTruthy()
    })
    expect(screen.queryByText('unknown-editor')).toBeNull()
  })

  it('omits the reveal entry when the Host has no file manager', async () => {
    mount({ externalApps: vi.fn(async () => ({ ...catalogue, canReveal: false })) })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText('文件 (默认)')).toBeTruthy()
    })
    expect(screen.queryByText('在文件夹中显示')).toBeNull()
  })

  it('keeps the default entry when the catalogue read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ externalApps: vi.fn(async () => { throw new Error('host offline') }) })
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('external application catalogue unavailable:', expect.any(Error))
    })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    expect(screen.getByText('打开工作区文件夹')).toBeTruthy()
    warn.mockRestore()
  })

  it('drops a catalogue that arrives after the header closed', async () => {
    let resolveCatalogue: (share: ExternalAppsShare) => void = () => {}
    const pending = new Promise<ExternalAppsShare>((accept) => {
      resolveCatalogue = accept
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { view } = mount({ externalApps: vi.fn(() => pending) })
    view.unmount()
    resolveCatalogue(catalogue)
    await pending
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('hands an application path to the Host', async () => {
    const { props } = mount()
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    fireEvent.click(await screen.findByText('Cursor'))
    await waitFor(() => {
      expect(props.openPath).toHaveBeenCalledWith(sid('session'), { kind: 'app', appId: 'cursor' })
    })
  })

  it('hands the default and reveal destinations to the Host', async () => {
    const { props } = mount()
    await waitFor(() => {
      expect(screen.getByLabelText('文件 (默认)')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('文件 (默认)'))
    await waitFor(() => {
      expect(props.openPath).toHaveBeenCalledWith(sid('session'), { kind: 'default' })
    })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    fireEvent.click(await screen.findByText('在文件夹中显示'))
    await waitFor(() => {
      expect(props.openPath).toHaveBeenCalledWith(sid('session'), { kind: 'reveal' })
    })
  })

  it('reports a refused path open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ openPath: vi.fn(async () => { throw new Error('no desktop') }) })
    await waitFor(() => {
      expect(screen.getByLabelText('文件 (默认)')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('文件 (默认)'))
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('session path open rejected:', expect.any(Error))
    })
    // The refusal is shown to the user, not only logged.
    expect(screen.getByRole('alert').textContent).toContain('no desktop')
    warn.mockRestore()
  })

  it('reports a non-error path refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ openPath: vi.fn(async () => { throw 'plain failure' }) })
    await waitFor(() => {
      expect(screen.getByLabelText('文件 (默认)')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('文件 (默认)'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plain failure')
    })
    warn.mockRestore()
  })

  it('pins and unpins the session from the quick button', async () => {
    const { props } = mount()
    fireEvent.click(screen.getByLabelText('固定会话'))
    await waitFor(() => {
      expect(props.pinSession).toHaveBeenCalledWith(sid('session'), true)
    })
  })

  it('marks a pinned session and offers to unpin it', async () => {
    const workspaces: WorkspaceSnapshot = {
      items: [],
      archivedSessionIds: [],
      pinnedSessionIds: [sid('session')],
      state: 'idle',
      phase: 'ready',
      error: null,
    }
    const { props } = mount({ useWorkspaces: hook(workspaces) })
    expect(screen.getByLabelText('取消固定会话')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('取消固定会话'))
    await waitFor(() => {
      expect(props.pinSession).toHaveBeenCalledWith(sid('session'), false)
    })
  })

  it('reports a refused pin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ pinSession: vi.fn(async () => { throw new Error('pin refused') }) })
    fireEvent.click(screen.getByLabelText('固定会话'))
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('session pin rejected:', expect.any(Error))
    })
    warn.mockRestore()
  })

  it('renames the session through the overflow menu', async () => {
    const { props } = mount()
    await selectAction('重命名')
    const input = screen.getByLabelText('会话名称') as HTMLInputElement
    expect(input.value).toBe('Renamed session')
    fireEvent.change(input, { target: { value: 'New title' } })
    fireEvent.click(screen.getByText('重命名', { selector: 'button' }))
    await waitFor(() => {
      expect(props.renameSession).toHaveBeenCalledWith(sid('session'), 'New title')
    })
  })

  it('keeps the rename dialog open when the write fails', async () => {
    mount({ renameSession: vi.fn(async () => { throw new Error('title write failed') }) })
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByText('重命名', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('title write failed')
    })
    expect(screen.getByLabelText('会话名称')).toBeTruthy()
  })

  it('reports a non-error rename failure', async () => {
    mount({ renameSession: vi.fn(async () => { throw 'plain failure' }) })
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByText('重命名', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plain failure')
    })
  })

  it('refuses an empty rename', async () => {
    const { props } = mount()
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '   ' } })
    const confirm = screen.getByText('重命名', { selector: 'button' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(props.renameSession).not.toHaveBeenCalled()
  })

  it('deletes the session only after the confirmation', async () => {
    const { props } = mount()
    await selectAction('删除会话')
    fireEvent.click(screen.getByText('删除会话', { selector: 'button' }))
    await waitFor(() => {
      expect(props.deleteSession).toHaveBeenCalledWith(sid('session'))
    })
  })

  it('keeps the delete dialog open when the delete fails', async () => {
    mount({ deleteSession: vi.fn(async () => { throw new Error('delete refused') }) })
    await selectAction('删除会话')
    fireEvent.click(screen.getByText('删除会话', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('delete refused')
    })
  })

  it('reports a non-error delete failure', async () => {
    mount({ deleteSession: vi.fn(async () => { throw 'plain failure' }) })
    await selectAction('删除会话')
    fireEvent.click(screen.getByText('删除会话', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plain failure')
    })
  })

  it('forks and copies the session id from the overflow menu', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { props } = mount()
    await selectAction('分叉会话')
    expect(props.forkSession).toHaveBeenCalledWith(sid('session'))
    await selectAction('复制会话 ID')
    expect(writeText).toHaveBeenCalledWith('session')
  })

  it('reports a refused archive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ archiveSession: vi.fn(async () => { throw new Error('archive refused') }) })
    fireEvent.click(screen.getByLabelText('归档会话'))
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('session archive rejected:', expect.any(Error))
    })
    warn.mockRestore()
  })

  it('toggles the right sidebar when the layout owns one', async () => {
    const toggleRightbar = vi.fn()
    mount({ toggleRightbar })
    fireEvent.click(screen.getByLabelText('切换右侧栏'))
    expect(toggleRightbar).toHaveBeenCalled()
  })

  it('runs the session shortcuts and leaves editable fields alone', async () => {
    const { props } = mount()
    fireEvent.keyDown(window, { key: 'g', ctrlKey: true, altKey: true })
    await waitFor(() => {
      expect(screen.getByLabelText('会话名称')).toBeTruthy()
    })
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, altKey: true })
    expect(props.forkSession).toHaveBeenCalledWith(sid('session'))
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true })
    await waitFor(() => {
      expect(props.archiveSession).toHaveBeenCalledWith(sid('session'))
    })

    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'g', ctrlKey: true, altKey: true })
    expect(props.forkSession).toHaveBeenCalledTimes(1)
  })

  it('reports a refused archive from the keyboard shortcut', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ archiveSession: vi.fn(async () => { throw new Error('archive refused') }) })
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true })
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('session archive rejected:', expect.any(Error))
    })
    warn.mockRestore()
  })

  it('archives the session from the quick button', async () => {
    const { props } = mount()
    fireEvent.click(screen.getByLabelText('归档会话'))
    await waitFor(() => {
      expect(props.archiveSession).toHaveBeenCalledWith(sid('session'))
    })
  })

  it('reports a refused archive from the quick button', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ archiveSession: vi.fn(async () => { throw new Error('archive refused') }) })
    fireEvent.click(screen.getByLabelText('归档会话'))
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('session archive rejected:', expect.any(Error))
    })
    warn.mockRestore()
  })

  it('copies the session id without a clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const { props } = mount()
    await selectAction('复制会话 ID')
    expect(props.forkSession).not.toHaveBeenCalled()
  })
  it('opens the default destination from the menu entry', async () => {
    const { props } = mount()
    await waitFor(() => {
      expect(screen.getByLabelText('文件 (默认)')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    fireEvent.click(await screen.findByText('文件 (默认)'))
    await waitFor(() => {
      expect(props.openPath).toHaveBeenCalledWith(sid('session'), { kind: 'default' })
    })
  })

  it('closes both menus without selecting', async () => {
    mount()
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy()
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    fireEvent.click(screen.getByLabelText('更多会话操作'))
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy()
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  it('closes the rename and delete dialogs without acting', async () => {
    const { props } = mount()
    await selectAction('重命名')
    fireEvent.click(screen.getByText('取消', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('会话名称')).toBeNull()
    })
    await selectAction('删除会话')
    fireEvent.click(screen.getByText('取消', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(props.deleteSession).not.toHaveBeenCalled()
  })

  it('closes the rename dialog with Escape', async () => {
    mount()
    await selectAction('重命名')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByLabelText('会话名称')).toBeNull()
    })
  })

  it('ignores an empty rename submitted from the keyboard', async () => {
    const { props } = mount()
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '  ' } })
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Enter' })
    expect(props.renameSession).not.toHaveBeenCalled()
  })

  it('ignores a second rename while the first one is in flight', async () => {
    const { props } = mount({
      renameSession: vi.fn(() => new Promise<void>(() => {})),
    })
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'New title' } })
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Enter' })
    expect(props.renameSession).toHaveBeenCalledTimes(1)
  })

  it('ignores a second delete while the first one is in flight', async () => {
    const { props } = mount({
      deleteSession: vi.fn(() => new Promise<void>(() => {})),
    })
    await selectAction('删除会话')
    const confirm = screen.getByText('删除会话', { selector: 'button' }) as HTMLButtonElement
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(confirm.disabled).toBe(true)
    })
    fireEvent.click(confirm)
    expect(props.deleteSession).toHaveBeenCalledTimes(1)
  })

  it('closes the delete dialog with Escape', async () => {
    const { props } = mount()
    await selectAction('删除会话')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(props.deleteSession).not.toHaveBeenCalled()
  })

  it('ignores a key that matches no session shortcut', async () => {
    const { props } = mount()
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    expect(props.forkSession).not.toHaveBeenCalled()
    expect(props.archiveSession).not.toHaveBeenCalled()
  })

  it('shows an empty title for a session the list does not carry', () => {
    mount({ sessionId: sid('missing') })
    expect(screen.getByLabelText('打开工作区文件夹')).toBeTruthy()
  })
})
