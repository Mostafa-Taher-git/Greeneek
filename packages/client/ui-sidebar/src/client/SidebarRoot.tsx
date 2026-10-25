/**
 * Sidebar shell: column geometry only. The brand row is the column's bottom
 * seat (above the foot stack): the wordmark expanded — doubling as a New
 * Session shortcut — or the static mark on the rail; the fold toggle lives
 * in the desktop titlebar. Collapse is a slide plus crossfade: content
 * freezes at its expanded width (inline style) and fades out in place while
 * the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts. The bottom-pinned
 * settings control only fades. The workspace/session browsing region between
 * the New Session button and the brand row is the `sidebar.workspaces`
 * registrant's, and the foot holds `sidebar.settings` plus
 * `sidebar.footer.action`; the shell hands them the wide flag (plus an
 * expand request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  FishLogo, IconNewChatOutline16, Tooltip,
} from '@greeneek/gnk-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * One-shot expand entrance window. The child stagger itself ends at 320ms
 * (120ms delay + 200ms entrance), but the New Session sheen starts at 60ms and
 * runs 480ms, so the `.expanding` class must live ~600ms to let it finish. It
 * must drop again so the next expand can restart the choreography — a class
 * that stayed on would play once per app session instead of once per expand.
 */
const EXPAND_SETTLE_MS = 600

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Expand entrance (V2): a live collapsed → expanded flip gets the neon
  // stagger (New Session, browsing region, brand mark, foot) and the one-shot
  // sheen across the New Session capsule. A cold expanded render never sets
  // it, so the first paint is still, and a collapse mid-entrance clears it so
  // the collapse choreography owns the column again.
  const [expanding, setExpanding] = useState(false)
  const wasCollapsed = useRef(collapsed)
  // Layout effect, not effect: the class has to be on the FIRST painted frame
  // of the expanded tree. An after-paint effect would let the wide content
  // flash at rest for a frame, then snap back to the entrance's hidden start.
  useLayoutEffect(() => {
    const was = wasCollapsed.current
    wasCollapsed.current = collapsed
    setExpanding(!collapsed && was)
  }, [collapsed])

  // Drop the one-shot class once the slowest entrance (the sheen) finishes, so
  // a later expand replays the choreography instead of finding it still set.
  useEffect(() => {
    if (!expanding) return
    const timer = window.setTimeout(() => { setExpanding(false) }, EXPAND_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [expanding])

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  return (
    <div
      ref={column}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading, !pointerInside && css.quietBars,
        expanding && css.expanding,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      {/* Expanded, the button carries its own label — tooltip only on the
          rail. The one collapse control lives in the desktop titlebar, so the
          rail renders no duplicate toggle. */}
      {wide && (
        <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
          <button
            type="button"
            className={css.newSession}
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <IconNewChatOutline16 size={14} />
            <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>
          </button>
        </Tooltip>
      )}

      {/* The browsing region fills the column between the controls and the
          brand row in both states; its rail icon column rides the same slot. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Brand seat: the wordmark sits at the column's bottom, above the foot
          stack, in both sidebar widths. */}
      <div className={css.logoRow}>
        <button
          type="button"
          className={clsx(css.brand, wide && css.wide)}
          aria-label={t('brand.home')}
          onClick={() => { startSession() }}
        >
          <span className={css.brandIdentity} aria-hidden="true">
            <span className={css.brandMark}>
              {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
            </span>
            {wide && (
              <span className={css.brandName}>
                {renderSlot('sidebar.brand.name', {}, {
                  fallback: <span className={css.fallbackBrandName}>{t('brand.name')}</span>,
                })}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Footer actions stack above Settings in both sidebar widths. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
    </div>
  )
}
