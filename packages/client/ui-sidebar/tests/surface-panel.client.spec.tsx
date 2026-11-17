// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { formatShortcut } from '@greeneek/gnk-client-ui-primitives'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { SurfacePanelComponentProps } from '../src/client/contract/slots.ts'
import { createRightPanelStore } from '../src/client/right-panel-store.ts'
import { SurfacePanel } from '../src/client/SurfacePanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: SurfacePanelComponentProps['t'] = makeTranslate(zh)
const SID = 's1' as SessionId

function mount(overrides: Partial<SurfacePanelComponentProps> = {}) {
  const verbs = {
    openTerminal: vi.fn(),
    openTrajectory: vi.fn(),
    openChat: vi.fn(),
    openSettings: vi.fn(),
    openDashboard: vi.fn(),
    loadDevice: vi.fn(async () => ({
      hostname: 'test-host', home: '/home/u', isLoopback: true, platform: 'linux', apps: [],
    })),
    browseFiles: vi.fn(async () => ({
      path: '/home/u', home: '/home/u',
      crumbs: [{ name: '/', path: '/', kind: 'directory' as const, hidden: false }],
      entries: [{ name: 'notes.txt', path: '/home/u/notes.txt', kind: 'file' as const, hidden: false }],
      truncated: false,
    })),
    readFile: vi.fn(async (path: string) => ({ path, text: 'hello', binary: false, size: 5 })),
    loadDiff: vi.fn(async () => ({
      isRepository: true, baseBranch: 'main',
      files: [{ path: 'a.ts', status: 'M', patch: '@@ -1 +1 @@' }], truncated: false,
    })),
    githubStatus: vi.fn(async () => ({ configured: true, pageLimit: 100 })),
    githubRepository: vi.fn(async () => ({ owner: 'o', repo: 'r' })),
    githubPullRequests: vi.fn(async () => ({
      items: [{
        number: 7, title: 'A PR', state: 'open', url: 'https://github.com/o/r/pull/7',
        branch: 'feature', author: 'alice', draft: false, updatedAt: '',
      }],
      hasNext: false,
    })),
    githubLinkedPullRequests: vi.fn(async () => ({ items: [], hasNext: false })),
    currentBranch: vi.fn(async () => 'feature'),
    forkSideChat: vi.fn(async () => 'child-1'),
    openSideChat: vi.fn(),
    useSessions: (selector: (state: { byId: Record<string, { cwd?: string }> }) => unknown) =>
      selector({ byId: { s1: { cwd: '/workspace/demo' } } }),
  }
  const handle = createRightPanelStore().create()
  const props = {
    sessionId: SID,
    t,
    useStore: bindSnapshotSelector(handle.store),
    actions: handle.actions,
    ...verbs,
    ...overrides,
  } as unknown as SurfacePanelComponentProps
  render(<SurfacePanel {...props} />)
  return { ...verbs, handle }
}

describe('SurfacePanel', () => {
  it('lists the eight T3 launcher rows with their single-key chips', () => {
    mount()
    expect(screen.getByRole('heading', { name: '打开一个面板' })).toBeTruthy()
    for (const label of ['浏览器', '终端', '文件', '差异', '拉取请求', '关联的拉取请求', '设备', '侧边对话']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    for (const key of ['b', 't', 'f', 'd', 'p', 'l', 'm', 's']) {
      expect(screen.getByText(formatShortcut(key))).toBeTruthy()
    }
  })

  it('offers the Browser profile submenu', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '选择浏览器配置' }))
    expect(screen.getByText('默认')).toBeTruthy()
    expect(screen.getByText('无痕')).toBeTruthy()
  })

  it('opens an isolated browser profile surface from the submenu', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '选择浏览器配置' }))
    fireEvent.click(screen.getByText('无痕'))
    await waitFor(() => { expect(screen.getByText('浏览器面板仅在桌面应用中可用。')).toBeTruthy() })
  })

  it('opens the terminal drawer from its row', () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '终端' }))
    expect(verbs.openTerminal).toHaveBeenCalledOnce()
  })

  it('opens the Device surface and renders the Host facts', async () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '设备' }))
    await waitFor(() => {
      expect(verbs.loadDevice).toHaveBeenCalled()
    })
    expect(screen.getByText('test-host')).toBeTruthy()
    expect(screen.getByText('linux')).toBeTruthy()
  })

  it('browses a Host directory and reads a file from the Files surface', async () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    await waitFor(() => { expect(verbs.browseFiles).toHaveBeenCalledWith(undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }))
    await waitFor(() => { expect(verbs.readFile).toHaveBeenCalledWith('/home/u/notes.txt') })
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('shows the Host unified diff for the current workspace', async () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '差异' }))
    await waitFor(() => { expect(verbs.loadDiff).toHaveBeenCalledWith('/workspace/demo') })
    expect(screen.getByText('a.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /a\.ts/ }))
    expect(screen.getByText('@@ -1 +1 @@')).toBeTruthy()
  })

  it('lists real pull requests from the GitHub backend', async () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '拉取请求' }))
    await waitFor(() => { expect(verbs.githubPullRequests).toHaveBeenCalled() })
    expect(screen.getByText('A PR')).toBeTruthy()
  })

  it('lists linked pull requests for the current branch', async () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '关联的拉取请求' }))
    await waitFor(() => { expect(verbs.currentBranch).toHaveBeenCalledWith('/workspace/demo') })
    expect(verbs.githubPullRequests).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature' }))
  })

  it('forks a real side session and opens it in the conversation', async () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '侧边对话' }))
    await waitFor(() => { expect(verbs.forkSideChat).toHaveBeenCalledWith(SID) })
    fireEvent.click(screen.getByRole('button', { name: '在主对话中打开' }))
    expect(verbs.openSideChat).toHaveBeenCalledWith('child-1')
  })

  it('offers every launcher row as an enabled control', () => {
    mount()
    for (const label of ['浏览器', '终端', '文件', '差异', '拉取请求', '关联的拉取请求', '设备', '侧边对话']) {
      expect(screen.getByRole('button', { name: label })).toHaveProperty('disabled', false)
    }
  })

  it('opens the two Session views and two full-page destinations from the extra rows', () => {
    const verbs = mount()
    fireEvent.click(screen.getByRole('button', { name: '执行轨迹' }))
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '仪表盘' }))
    expect(verbs.openTrajectory).toHaveBeenCalledWith(SID)
    expect(verbs.openChat).toHaveBeenCalledWith(SID)
    expect(verbs.openSettings).toHaveBeenCalledOnce()
    expect(verbs.openDashboard).toHaveBeenCalledOnce()
  })
})
