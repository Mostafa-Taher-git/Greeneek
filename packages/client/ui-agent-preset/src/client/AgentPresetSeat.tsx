/**
 * The agent-mode switcher on the new-session screen, beside the workspace
 * picker: a horizontal hover-to-reveal pill row over the same staging flow
 * the dropdown chip used to own.
 *
 * It lives here rather than in the composer because the choice is only
 * available before a conversation starts: once a turn has run, the session's
 * history was produced under that preset's tools and the host refuses to swap
 * them. A control that spends most of its life disabled belongs on the screen
 * where it still works.
 *
 * Picking stages; the choice reaches a session when one becomes current.
 */

import { useEffect, useRef, useState } from 'react'
import type { SnapshotStore } from '@greeneek/gnk-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import {
  IconAgentPresetOutline16,
  IconBrainCircuit16,
  IconCircleDashedCheck16,
  IconCirclePile16,
  IconSparkle16,
  IconSquareDashedBottomCode16,
  IconWarningOutline16,
  Toast,
} from '@greeneek/gnk-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import { ModeSwitcher, type ModeSwitcherEntry } from './ModeSwitcher.tsx'
import { presetDisplayText } from './locales.ts'

/** Registration-side business face for the hero seat. */
export interface AgentPresetSeatInjected {
  hooks: {
    /** Seat snapshot bound by the renderer as useAgentPresetSeat. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  /** Read the roster when the seat first renders. */
  load: () => Promise<void>
  /** Stage one preset for the next session; resolves to a refusal, or undefined. */
  select: (id: string) => Promise<string | undefined>
  /** Clear the one-shot introduce cue once the seat has played it. */
  introduced: () => void
}

/**
 * How long a refused switch holds before fading.
 *
 * Longer than the primitive's default because this banner is the only place
 * the refusal appears. The row has already snapped back to the preset the
 * session still runs, and a preset the host refuses to MOUNT is one
 * discovery reported healthy — its row on the settings page carries no
 * reason to go back and read, because there was nothing to see until the
 * rows actually ran.
 */
const REFUSAL_HOLD_MS = 8000

/** Shipped modes in row order; everything else appends after them. */
const MODE_ORDER = ['standard', 'ptc', 'cordis'] as const

/** Full component props. */
export type AgentPresetSeatProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSeatInjected>

/**
 * Render the new-session mode switcher.
 * @param props - composed slot props.
 * @returns the pill row, or null when the deployment composes no presets.
 */
export function AgentPresetSeat({ load, select, introduced, useAgentPresetSeat, t }: AgentPresetSeatProps) {
  const state = useAgentPresetSeat(snapshot => snapshot)
  // The seq keys the banner, so picking the same broken preset twice replays
  // it rather than leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const ready = state.options.length > 0 && state.current !== ''

  // The introduce cue used to animate the chip label; the pill row shows the
  // staged mode active, so the cue only needs acknowledging.
  useEffect(() => {
    if (state.introduce && ready) introduced()
  }, [state.introduce, ready, introduced])

  // Nothing to choose between: the deployment composes no presets and every
  // session shares the host composition.
  if (!ready) return null

  const entries: ModeSwitcherEntry[] = [
    ...MODE_ORDER.flatMap((id) => {
      const option = state.options.find(candidate => candidate.id === id)
      if (option === undefined) return []
      const text = presetDisplayText(option, t)
      return [{
        id: option.id,
        name: text.name,
        description: text.description ?? t('noDescription'),
        icon: id === 'standard'
          ? <IconSquareDashedBottomCode16 size={16} />
          : id === 'ptc'
            ? <IconCircleDashedCheck16 size={16} />
            : <IconSparkle16 size={16} />,
      }]
    }),
    // Placeholder modes for v1.1.1: visible and previewable, never selectable
    // until their presets land.
    {
      id: 'army',
      name: t('presetArmyName'),
      description: t('presetArmyDescription'),
      icon: <IconCirclePile16 size={16} />,
      disabled: true,
      disabledReason: t('switcherComingSoon'),
    },
    {
      id: 'maestro',
      name: t('presetMaestroName'),
      description: t('presetMaestroDescription'),
      icon: <IconBrainCircuit16 size={16} />,
      disabled: true,
      disabledReason: t('switcherComingSoon'),
    },
    // Authored presets keep a live pill after the shipped set: hiding them
    // would strand sessions their owners can still start elsewhere.
    ...state.options
      .filter(option => !(MODE_ORDER as readonly string[]).includes(option.id))
      .map((option) => {
        const text = presetDisplayText(option, t)
        return {
          id: option.id,
          name: text.name,
          description: text.description ?? t('noDescription'),
          icon: <IconAgentPresetOutline16 size={16} />,
        }
      }),
  ]

  const choose = (id: string): void => {
    const picked = entries.find(entry => entry.id === id)
    // The fallback is for the row shape `find` cannot promise; the row's
    // items ARE `entries`, so an emitted id is always one of them.
    /* v8 ignore next */
    const name = picked === undefined ? id : picked.name
    void select(id).then((refusal) => {
      // Announced only for a pick a person just made: `apply()` also runs
      // when a session becomes current, and a banner over that would
      // report a refusal nobody asked for.
      if (refusal === undefined) return
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('switchRefused', { name, reason: refusal }) })
    })
  }

  return (
    <>
      <ModeSwitcher
        label={t('switcherLabel')}
        entries={entries}
        current={state.current}
        busy={state.busy}
        onSelect={choose}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card, which is the content column this seat sits
          // above rather than inside — hence a page query, not `closest`.
          // Absent, the banner centers on the window, which is off-center
          // whenever the sidebar is open.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}
