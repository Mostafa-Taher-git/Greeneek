// @vitest-environment jsdom
/**
 * CommandsSection state spec: the settings roster reads the current session's
 * host command catalog — rows render `/name` plus description, an empty
 * catalog and a missing session each render their own explicit status, and a
 * failed pull renders an alert with a working retry button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { CommandDescriptor } from '../src/client/directory.ts'
import type { CommandsSectionProps } from '../src/client/CommandsSection.tsx'
import { CommandsSection } from '../src/client/CommandsSection.tsx'
import { makeTranslate } from '@greeneek/gnk-client-test-runtime'
import { zh as commonZh } from '@greeneek/gnk-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'

type Props = CommandsSectionProps

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: Props['t'] = makeTranslate(zh, commonZh)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function bench(over?: {
  readonly current?: SessionId | undefined
  readonly listCommands?: Props['listCommands']
}) {
  const listCommands = over?.listCommands ?? (async () => [] as readonly CommandDescriptor[])
  const useSessions = <S,>(sel: (s: { current: SessionId | undefined }) => S): S =>
    sel({ current: over?.current })
  const view = render(
    <CommandsSection {...({ useSessions, t, listCommands } as unknown as Props)} />,
  )
  return { view, listCommands }
}

describe('CommandsSection', () => {
  it('renders one row per command with /name and description', async () => {
    const commands: readonly CommandDescriptor[] = [
      { name: 'plan', description: 'Draft a plan first', input: { hint: '' } },
      { name: 'review', description: '', input: { hint: '' } },
    ]
    bench({ current: 's1' as SessionId, listCommands: async () => commands })
    expect(await screen.findByText('/plan')).toBeTruthy()
    expect(screen.getByText('Draft a plan first')).toBeTruthy()
    expect(screen.getByText('/review')).toBeTruthy()
  })

  it('renders the empty status when the catalog has no commands', async () => {
    bench({ current: 's1' as SessionId })
    expect(await screen.findByText('该会话没有可用指令')).toBeTruthy()
  })

  it('renders the no-session status without pulling the catalog', async () => {
    const listCommands = vi.fn(async () => [] as readonly CommandDescriptor[])
    bench({ current: undefined, listCommands })
    expect(await screen.findByText('没有当前会话——打开一个会话后可在此查看它的指令')).toBeTruthy()
    expect(listCommands).not.toHaveBeenCalled()
  })

  it('renders the error alert with a retry that re-pulls', async () => {
    const listCommands = vi.fn(async () => [] as readonly CommandDescriptor[])
    listCommands.mockRejectedValueOnce(new Error('boom'))
    const { view } = bench({ current: 's1' as SessionId, listCommands })
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('该会话没有可用指令')).toBeTruthy()
    expect(listCommands).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})
