// @vitest-environment jsdom
/**
 * AboutSection state spec: version rows read the desktop bridge when present
 * and the injected web version otherwise; the Check button drives the bridge
 * check with a live status line, Restart-and-install appears once downloaded,
 * and a plain browser tab links the desktop downloads instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AboutSectionProps } from '../src/client/AboutSection.tsx'
import { AboutSection } from '../src/client/AboutSection.tsx'
import { en } from '../src/client/locales.ts'

type Props = AboutSectionProps

// The seat's key domain is settings; the stub answers from the package
// dictionary and falls back to the key like the real chain.
const t: Props['t'] = key => (en as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  const globals = globalThis as Record<string, unknown>
  globals.greeneekDesktop = undefined
  globals.__GNK_VERSION__ = undefined
})

function bench() {
  const props = { t } as unknown as Props
  return render(<AboutSection {...props} />)
}

function stageBridge(over?: {
  readonly versions?: () => Promise<{ desktop: string; harness?: unknown }>
  readonly status?: string
  readonly checkState?: string
}) {
  const checkForUpdates = vi.fn(async () => ({ state: over?.checkState ?? 'up-to-date' }))
  const doInstall = vi.fn(async () => undefined)
  ;(globalThis as Record<string, unknown>).greeneekDesktop = {
    versions: over?.versions ?? (async () => ({ desktop: '0.2.0', harness: '1.1.0-alpha.0' })),
    updateStatus: async () => ({ state: over?.status ?? 'idle' }),
    checkForUpdates,
    installUpdate: doInstall,
  }
  return { checkForUpdates, installUpdate: doInstall }
}

describe('AboutSection', () => {
  it('renders desktop and harness versions from the bridge', async () => {
    stageBridge()
    bench()
    expect(await screen.findByText('Desktop version')).toBeTruthy()
    expect(screen.getByText('0.2.0')).toBeTruthy()
    expect(screen.getByText('Bundled harness version')).toBeTruthy()
    expect(screen.getByText('1.1.0-alpha.0')).toBeTruthy()
  })

  it('renders the served version with a downloads link outside the desktop', async () => {
    (globalThis as Record<string, unknown>).__GNK_VERSION__ = '1.1.0-alpha.0'
    bench()
    expect(await screen.findByText('Greeneek version')).toBeTruthy()
    expect(screen.getByText('1.1.0-alpha.0')).toBeTruthy()
    const link = screen.getByText('Get Greeneek Desktop')
    expect(link.getAttribute('href')).toBe('https://www.greeneek.duckdns.org/downloads/')
  })

  it('renders Unknown when no version fact exists', async () => {
    bench()
    expect(await screen.findByText('Greeneek version')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it('checks for updates and reports the fresh status', async () => {
    const { checkForUpdates } = stageBridge({ status: 'idle', checkState: 'up-to-date' })
    bench()
    expect(await screen.findByText('Check for updates')).toBeTruthy()
    fireEvent.click(screen.getByText('Check for updates'))
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('You are up to date')).toBeTruthy()
  })

  it('offers restart-and-install once an update is downloaded', async () => {
    const { installUpdate } = stageBridge({ status: 'downloaded' })
    bench()
    const restart = await screen.findByText('Restart and install')
    fireEvent.click(restart)
    expect(installUpdate).toHaveBeenCalledTimes(1)
  })
})
