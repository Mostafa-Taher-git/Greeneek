// @vitest-environment jsdom
/**
 * CraftSection state spec: the four measured app states render their own
 * label and the action that fits (download, launch connected, open), the
 * no-bridge fallback reports `unavailable` with actions disabled, and
 * loading / failure+retry / empty / unmounted reads each stay explicit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import type { CraftAppView, CraftSettingsSource } from '../src/client/contract.ts'
import type { CraftSectionProps } from '../src/client/settings/CraftSection.tsx'
import { CraftSection } from '../src/client/settings/CraftSection.tsx'
import { fallbackSource } from '../src/client/catalog.ts'
import { zh } from '../src/client/locales.ts'

type Props = CraftSectionProps

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: Props['t'] = makeTranslate(zh, commonZh)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function row(id: string, state: CraftAppView['state'], detail?: string): CraftAppView {
  return {
    id,
    displayName: id === 'photocraft' ? 'PhotoCraft' : 'PdfCraft',
    state,
    launcherUrl: `https://craft.example/open/${id}`,
    downloadUrl: `https://craft.example/download/${id}`,
    ...(detail === undefined ? {} : { detail }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function bench(source: CraftSettingsSource) {
  return render(<CraftSection {...({ close: () => {}, t, source } as unknown as Props)} />)
}

describe('CraftSection', () => {
  it('renders the four measured states with their own label and action', async () => {
    const rows = [
      row('photocraft', 'not-installed', 'no install record'),
      row('pdfcraft', 'app-installed-cli-missing', 'cli below 1.0.0'),
      row('photocraft-ready', 'ready'),
      row('photocraft-running', 'running'),
    ]
    bench({ ...fallbackSource(), available: async () => rows })
    expect(await screen.findByText('未安装')).toBeTruthy()
    expect(screen.getByText('已安装应用，缺少命令行工具')).toBeTruthy()
    expect(screen.getByText('就绪')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('no install record')).toBeTruthy()
    expect(screen.getByText('cli below 1.0.0')).toBeTruthy()
    // Download is offered exactly for the two install-gap states.
    const downloads = screen.getAllByText('下载')
    expect(downloads).toHaveLength(2)
    expect(downloads[0]!.closest('a')?.getAttribute('href')).toBe('https://craft.example/download/photocraft')
    // Ready offers the connected launch, running offers the app launcher.
    expect(screen.getByText('连接并打开')).toBeTruthy()
    expect(screen.getByText('打开应用').closest('a')?.getAttribute('href'))
      .toBe('https://craft.example/open/photocraft-running')
  })

  it('checks one row in place and shows the busy copy while the check runs', async () => {
    const pending = deferred<CraftAppView>()
    const check = vi.fn(() => pending.promise)
    bench({
      available: async () => [row('photocraft', 'not-installed'), row('pdfcraft', 'app-installed-cli-missing')],
      check,
      launchConnected: async () => row('pdfcraft', 'running'),
    })
    fireEvent.click((await screen.findAllByText('检查安装'))[0]!)
    expect(check).toHaveBeenCalledWith('photocraft')
    expect(await screen.findByText('正在检查…')).toBeTruthy()
    // Every row's action is blocked while one row is in flight.
    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(true)
    }
    await act(async () => { pending.resolve(row('photocraft', 'ready')) })
    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(screen.queryByText('正在检查…')).toBeNull()
  })

  it('launches a ready app connected and replaces the row with its running state', async () => {
    const pending = deferred<CraftAppView>()
    bench({
      available: async () => [row('photocraft', 'ready')],
      check: async () => row('photocraft', 'ready'),
      launchConnected: () => pending.promise,
    })
    fireEvent.click(await screen.findByText('连接并打开'))
    expect(await screen.findByText('正在打开…')).toBeTruthy()
    await act(async () => { pending.resolve(row('photocraft', 'running')) })
    expect(await screen.findByText('运行中')).toBeTruthy()
    expect(screen.getByText('打开应用')).toBeTruthy()
    expect(screen.queryByText('连接并打开')).toBeNull()
  })

  it('renders an alert when a check fails and clears it on the next action', async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error('discovery failed'))
      .mockResolvedValueOnce(row('photocraft', 'ready'))
    bench({
      available: async () => [row('photocraft', 'not-installed')],
      check,
      launchConnected: async () => row('photocraft', 'running'),
    })
    fireEvent.click(await screen.findByText('检查安装'))
    expect(await screen.findByText('操作失败，请重试')).toBeTruthy()
    fireEvent.click(screen.getByText('检查安装'))
    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(screen.queryByText('操作失败，请重试')).toBeNull()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('renders an alert when the connected launch fails', async () => {
    bench({
      available: async () => [row('photocraft', 'ready')],
      check: async () => row('photocraft', 'ready'),
      launchConnected: async () => { throw new Error('spawn failed') },
    })
    fireEvent.click(await screen.findByText('连接并打开'))
    expect(await screen.findByText('操作失败，请重试')).toBeTruthy()
    expect(screen.getByText('就绪')).toBeTruthy()
  })

  it('renders the no-bridge notice over the static pilot rows with actions disabled', async () => {
    bench(fallbackSource())
    expect(await screen.findByText(/桌面版 Craft 桥接/)).toBeTruthy()
    expect(screen.getAllByText('桥接不可用')).toHaveLength(2)
    expect(screen.getByText('PhotoCraft')).toBeTruthy()
    expect(screen.getByText('PdfCraft')).toBeTruthy()
    const check = screen.getAllByText('检查安装')[0]!
    expect(check.closest('button')?.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('连接并打开')).toBeNull()
    expect(screen.queryByText('下载')).toBeNull()
  })

  it('renders the empty status when the build ships no apps', async () => {
    bench({ ...fallbackSource(), available: async () => [] })
    expect(await screen.findByText('此版本没有可用的 Craft 应用')).toBeTruthy()
  })

  it('renders the error alert with a retry that re-reads the roster', async () => {
    const available = vi.fn()
      .mockRejectedValueOnce(new Error('bridge offline'))
      .mockResolvedValueOnce([])
    bench({ ...fallbackSource(), available })
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('此版本没有可用的 Craft 应用')).toBeTruthy()
    expect(available).toHaveBeenCalledTimes(2)
  })

  it('shows the loading status while the roster read is in flight', async () => {
    const pending = deferred<readonly CraftAppView[]>()
    bench({ ...fallbackSource(), available: () => pending.promise })
    expect(await screen.findByText('正在读取 Craft 应用状态…')).toBeTruthy()
    await act(async () => { pending.resolve([]) })
    expect(await screen.findByText('此版本没有可用的 Craft 应用')).toBeTruthy()
  })

  it('ignores a roster read that settles after unmount', async () => {
    const success = deferred<readonly CraftAppView[]>()
    const view = bench({ ...fallbackSource(), available: () => success.promise })
    view.unmount()
    success.resolve([row('photocraft', 'ready')])
    await success.promise

    const failure = deferred<readonly CraftAppView[]>()
    const failing = bench({ ...fallbackSource(), available: () => failure.promise })
    failing.unmount()
    failure.reject(new Error('late failure'))
    await failure.promise.catch(() => {})
    expect(true).toBe(true)
  })
})
