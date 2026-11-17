// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import type { SessionListState, SessionSummary } from '@greeneek/gnk-api-session-controller/client'
import type { WorkspaceSnapshot } from '@greeneek/gnk-api-workspace-controller/client'
import type { SessionId } from '@greeneek/gnk-session/types'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import type {
  ExternalAppsShare, GitFacts, ThreadDetailsPanelProps,
} from '../src/client/contract/slots.ts'
import { ThreadDetailsPanel } from '../src/client/ThreadDetailsPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ThreadDetailsPanelProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const CWD = '/projects/demo-app'
const summary = (id: string, title: string, cwd?: string): SessionSummary => ({
  id: sid(id),
  displayTitle: title,
  title,
  running: false,
  blank: false,
  updatedAt: 0,
  ...cwd === undefined ? {} : { cwd },
})

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

const catalogue: ExternalAppsShare = {
  platform: 'linux',
  apps: [{ id: 'cursor', available: true }, { id: 'vscode', available: false }],
  canReveal: true,
}

const gitFactsFixture: GitFacts = {
  isRepository: true,
  branch: 'main',
  baseBranch: 'origin/main',
  changedFiles: 2,
  insertions: 1200,
  deletions: 3,
}

/** Open the Session overflow menu and select one of its rows. */
async function selectAction(name: string): Promise<void> {
  fireEvent.click(screen.getByLabelText('更多会话操作'))
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

function mount(overrides: Partial<ThreadDetailsPanelProps> = {}) {
  const sessions: SessionListState = {
    ids: [sid('session')],
    byId: Object.fromEntries([[sid('session'), summary('session', 'Renamed session', CWD)]]),
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
  const owners: Record<string, unknown> = {}
  const keys: string[] = []
  const renderSlot = ((key: string, owner?: unknown) => {
    keys.push(key)
    owners[key] = owner
    if (key === 'conversation.details.thread.action') return <button type="button">Preset chip</button>
    if (key === 'conversation.details.thread.lineage') return <div>Lineage tree</div>
    if (key === 'conversation.details.thread.fleet') return <div>Fleet rows</div>
    return null
  }) as unknown as ThreadDetailsPanelProps['renderSlot']
  const props = {
    sessionId: sid('session'),
    useSessions: hook(sessions),
    useWorkspaces: hook(workspaces),
    useLineage: hook(true),
    useFleet: hook(true),
    useHostInfo: hook({ home: '/home/fixture', hostname: 'fixture-host', isLoopback: true }),
    renderSlot,
    pinSession: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    forkSession: vi.fn(),
    externalApps: vi.fn(async () => catalogue),
    openPath: vi.fn(async () => {}),
    gitFacts: vi.fn(async () => gitFactsFixture),
    toggleDetails: vi.fn(),
    toggleTerminalDrawer: vi.fn(),
    toggleRightPanel: vi.fn(),
    t,
    ...overrides,
  } as unknown as ThreadDetailsPanelProps
  const view = render(<ThreadDetailsPanel {...props} />)
  return { view, props, keys, owners }
}

describe('ThreadDetailsPanel workspace row', () => {
  it('names the Session workspace and opens it with the default destination', async () => {
    const { props } = mount()
    fireEvent.click(screen.getByLabelText('打开工作区“demo-app”'))
    await waitFor(() => {
      expect(props.openPath).toHaveBeenCalledWith(sid('session'), { kind: 'default' })
    })
  })

  it.each([
    ['darwin', '访达 (默认)'],
    ['win32', '文件资源管理器 (默认)'],
    ['aix', '打开工作区文件夹'],
  ] as const)('names the %s file manager in the row tooltip', async (platform, label) => {
    mount({ externalApps: vi.fn(async () => ({ ...catalogue, platform })) })
    fireEvent.focus(screen.getByLabelText('打开工作区“demo-app”'))
    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe(label)
    })
  })

  it('drops the workspace row for a Session with no directory', () => {
    mount({
      useSessions: hook({
        ids: [sid('session')],
        byId: Object.fromEntries([[sid('session'), summary('session', 'No directory')]]),
        current: sid('session'),
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {},
        currentAddress: undefined,
      } satisfies SessionListState),
    })
    expect(screen.queryByLabelText(/打开工作区/)).toBeNull()
  })

  it('shows an empty title for a Session the list does not carry', () => {
    mount({ sessionId: sid('missing') })
    expect(screen.getByLabelText('更多会话操作')).toBeTruthy()
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
    mount({ externalApps: vi.fn(async () => ({ ...catalogue, apps: [{ id, available: true }] })) })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText(label)).toBeTruthy()
    })
  })

  it('omits an application the Client has no name for', async () => {
    mount({ externalApps: vi.fn(async () => ({ ...catalogue, apps: [{ id: 'unknown-editor', available: true }] })) })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText('在文件夹中显示')).toBeTruthy()
    })
    expect(screen.queryByText('unknown-editor')).toBeNull()
    expect(screen.queryByText('文件 (默认)')).toBeNull()
  })

  it('omits the reveal entry when the Host has no file manager', async () => {
    mount({ externalApps: vi.fn(async () => ({ ...catalogue, canReveal: false })) })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByText('Cursor')).toBeTruthy()
    })
    expect(screen.queryByText('在文件夹中显示')).toBeNull()
  })

  it('offers no overflow destination when the catalogue read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ externalApps: vi.fn(async () => { throw new Error('host offline') }) })
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('external application catalogue unavailable:', expect.any(Error))
    })
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    expect(screen.queryByText('打开工作区文件夹')).toBeNull()
    expect(screen.queryByText('在文件夹中显示')).toBeNull()
    warn.mockRestore()
  })

  it('drops a catalogue that arrives after the card unmounted', async () => {
    let resolveCatalogue: (share: ExternalAppsShare) => void = () => {}
    const pending = new Promise<ExternalAppsShare>((accept) => { resolveCatalogue = accept })
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

  it('hands the reveal destination to the Host', async () => {
    const { props } = mount()
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    fireEvent.click(await screen.findByText('在文件夹中显示'))
    await waitFor(() => {
      expect(props.openPath).toHaveBeenCalledWith(sid('session'), { kind: 'reveal' })
    })
  })

  it('reports a refused path open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ openPath: vi.fn(async () => { throw new Error('no desktop') }) })
    fireEvent.click(screen.getByLabelText('打开工作区“demo-app”'))
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
    fireEvent.click(screen.getByLabelText('打开工作区“demo-app”'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plain failure')
    })
    warn.mockRestore()
  })

  it('closes the destination menu without selecting', async () => {
    mount()
    fireEvent.click(screen.getByLabelText('在外部应用或文件管理器中打开'))
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy()
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })
})

describe('ThreadDetailsPanel action row', () => {
  it('hosts the Session-scoped chips beside the pin, archive, and overflow controls', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Preset chip' })).toBeTruthy()
    expect(screen.getByLabelText('固定会话')).toBeTruthy()
    expect(screen.getByLabelText('归档会话')).toBeTruthy()
    expect(screen.getByLabelText('更多会话操作')).toBeTruthy()
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

  it('forks and copies the session id from the overflow menu', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { props } = mount()
    await selectAction('分叉会话')
    expect(props.forkSession).toHaveBeenCalledWith(sid('session'))
    await selectAction('复制会话 ID')
    expect(writeText).toHaveBeenCalledWith('session')
  })

  it('copies the session id without a clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const { props } = mount()
    await selectAction('复制会话 ID')
    expect(props.forkSession).not.toHaveBeenCalled()
  })

  it('closes the overflow menu without selecting', async () => {
    mount()
    fireEvent.click(screen.getByLabelText('更多会话操作'))
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy()
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })
})

describe('ThreadDetailsPanel rename dialog', () => {
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

  it('keeps the dialog open when the write fails', async () => {
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

  it('ignores an empty rename submitted from the keyboard', async () => {
    const { props } = mount()
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '  ' } })
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Enter' })
    expect(props.renameSession).not.toHaveBeenCalled()
  })

  it('ignores a second rename while the first one is in flight', async () => {
    const { props } = mount({ renameSession: vi.fn(() => new Promise<void>(() => {})) })
    await selectAction('重命名')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'New title' } })
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Enter' })
    expect(props.renameSession).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog without acting', async () => {
    const { props } = mount()
    await selectAction('重命名')
    fireEvent.click(screen.getByText('取消', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('会话名称')).toBeNull()
    })
    expect(props.renameSession).not.toHaveBeenCalled()
  })

  it('closes the dialog with Escape', async () => {
    mount()
    await selectAction('重命名')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByLabelText('会话名称')).toBeNull()
    })
  })
})

describe('ThreadDetailsPanel delete dialog', () => {
  it('deletes the session only after the confirmation', async () => {
    const { props } = mount()
    await selectAction('删除会话')
    fireEvent.click(screen.getByText('删除会话', { selector: 'button' }))
    await waitFor(() => {
      expect(props.deleteSession).toHaveBeenCalledWith(sid('session'))
    })
  })

  it('keeps the dialog open when the delete fails', async () => {
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

  it('ignores a second delete while the first one is in flight', async () => {
    const { props } = mount({ deleteSession: vi.fn(() => new Promise<void>(() => {})) })
    await selectAction('删除会话')
    const confirm = screen.getByText('删除会话', { selector: 'button' }) as HTMLButtonElement
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(confirm.disabled).toBe(true)
    })
    fireEvent.click(confirm)
    expect(props.deleteSession).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog without acting', async () => {
    const { props } = mount()
    await selectAction('删除会话')
    fireEvent.click(screen.getByText('取消', { selector: 'button' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(props.deleteSession).not.toHaveBeenCalled()
  })

  it('closes the dialog with Escape', async () => {
    const { props } = mount()
    await selectAction('删除会话')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(props.deleteSession).not.toHaveBeenCalled()
  })
})

describe('ThreadDetailsPanel git rows', () => {
  it('reads the branch and change set of the workspace directory', async () => {
    const { props } = mount()
    await waitFor(() => {
      expect(screen.getByText('main')).toBeTruthy()
    })
    expect(props.gitFacts).toHaveBeenCalledWith(CWD)
    expect(screen.getByText('相对 origin/main 的改动')).toBeTruthy()
    expect(screen.getByText('+1,200 −3')).toBeTruthy()
  })

  it('names a detached head and an unbased change set', async () => {
    mount({
      gitFacts: vi.fn(async () => ({
        isRepository: true, changedFiles: 1, insertions: 4, deletions: 5,
      })),
    })
    await waitFor(() => {
      expect(screen.getByText('分离头指针（未检出版本）')).toBeTruthy()
    })
    expect(screen.getByText('未提交改动')).toBeTruthy()
    expect(screen.getByText('+4 −5')).toBeTruthy()
  })

  it('shows no rows outside a repository', async () => {
    mount({
      gitFacts: vi.fn(async () => ({
        isRepository: false, changedFiles: 0, insertions: 0, deletions: 0,
      })),
    })
    await waitFor(() => {
      expect(screen.getByLabelText('更多会话操作')).toBeTruthy()
    })
    expect(screen.queryByText('main')).toBeNull()
    expect(screen.queryByText('未提交改动')).toBeNull()
  })

  it('keeps the rows out when the facts read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount({ gitFacts: vi.fn(async () => { throw new Error('git unavailable') }) })
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('workspace git facts unavailable:', expect.any(Error))
    })
    expect(screen.queryByText('main')).toBeNull()
    warn.mockRestore()
  })

  it('drops facts that arrive after the card unmounted', async () => {
    let resolveFacts: (facts: GitFacts) => void = () => {}
    const pending = new Promise<GitFacts>((accept) => { resolveFacts = accept })
    const { view } = mount({ gitFacts: vi.fn(() => pending) })
    view.unmount()
    resolveFacts(gitFactsFixture)
    await pending
    expect(screen.queryByText('main')).toBeNull()
  })
})

describe('ThreadDetailsPanel device row', () => {
  it('names the Host device and copies it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    expect(screen.getByText('fixture-host')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('复制设备名称'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('fixture-host')
    })
  })

  it('confirms the copy and clears the confirmation after the feedback window', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    try {
      mount()
      fireEvent.click(screen.getByLabelText('复制设备名称'))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByLabelText('已复制设备名称')).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(screen.getByLabelText('复制设备名称')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the plain affordance when the Host refuses the write', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    fireEvent.click(screen.getByLabelText('复制设备名称'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled()
    })
    expect(screen.getByLabelText('复制设备名称')).toBeTruthy()
  })

  it('drops the device row when the Host reports no name', () => {
    mount({ useHostInfo: hook({ home: undefined, hostname: undefined, isLoopback: true }) })
    expect(screen.queryByLabelText('复制设备名称')).toBeNull()
  })
})

describe('ThreadDetailsPanel lineage', () => {
  it('shows the lineage section while its hole is occupied', () => {
    const { owners } = mount()
    expect(screen.getByText('会话谱系')).toBeTruthy()
    expect(screen.getByText('Lineage tree')).toBeTruthy()
    expect(owners['conversation.details.thread.lineage']).toEqual({
      lineageSessionId: sid('session'),
      displayTitle: 'Renamed session',
    })
  })

  it('drops the section when no renderer occupies the hole', () => {
    mount({ useLineage: hook(false) })
    expect(screen.queryByText('会话谱系')).toBeNull()
  })
})

describe('ThreadDetailsPanel live fleet', () => {
  it('shows the fleet section while its hole is occupied', () => {
    const { keys } = mount()
    expect(screen.getByText('实时编队')).toBeTruthy()
    expect(screen.getByText('Fleet rows')).toBeTruthy()
    expect(keys).toContain('conversation.details.thread.fleet')
  })

  it('drops the section when no renderer occupies the hole', () => {
    mount({ useFleet: hook(false) })
    expect(screen.queryByText('实时编队')).toBeNull()
  })
})

describe('ThreadDetailsPanel shortcuts', () => {
  it('runs the session and panel shortcuts', async () => {
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
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true })
    expect(props.toggleDetails).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(props.toggleTerminalDrawer).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, altKey: true })
    expect(props.toggleRightPanel).toHaveBeenCalledOnce()
  })

  it('leaves editable fields and unrelated keys alone', () => {
    const { props } = mount()
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    expect(props.forkSession).not.toHaveBeenCalled()
    expect(props.toggleDetails).not.toHaveBeenCalled()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true, shiftKey: true })
    expect(props.toggleDetails).not.toHaveBeenCalled()
    input.remove()
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
})
