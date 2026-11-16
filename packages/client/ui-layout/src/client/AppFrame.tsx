/**
 * Shell frame, registered into the built-in 'root' slot (the web shell renders
 * only 'root'). Owns the grid tracks (sidebar | center | right panel), the drag
 * handles (pointer capture + rAF throttle), the concession chain (columns.ts),
 * and the child-slot render decisions. Thread Details is not a track: its
 * toggle opens a fixed-size card popover below the titlebar, so the center is
 * never squeezed and there is nothing to resize. The sidebar slot renders HERE
 * with live parameters from the concession solve; strict session entries gate
 * themselves on current-session availability while session-maybe entries
 * retain identity. Pure component: everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@greeneek/gnk-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'titlebar' | 'conversation' | 'settings' | 'dashboard' | 'details' | 'rightbar' | 'terminal.drawer' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/**
 * Thread Details popover: a fixed-size card anchored under the titlebar, not a
 * column. The subtree stays mounted while closed so its internal state
 * survives a close/reopen; a closed popover leaves the accessibility tree
 * and the tab order.
 */
function DetailsColumn(props: { children?: ReactNode; hidden: boolean; columnRef: RefObject<HTMLDivElement> }) {
  const { columnRef, ...rest } = props
  return <PanelColumn className={css.detailsCol} columnRef={columnRef} {...rest} />
}

/** Independent right panel grid item, with the same closed-panel semantics. */
function RightbarColumn(props: { children?: ReactNode; overlay?: boolean; hidden: boolean }) {
  return <PanelColumn className={css.rightbarCol} {...props} />
}

/**
 * One side column: mounted at all times, inert while it has no rendered width.
 * `inert` leaves the tab order and `aria-hidden` leaves the accessibility tree,
 * so a closed panel's off-screen controls cannot be reached. `inert` applies
 * first because it releases focus, and a browser refuses to hide a subtree
 * that still owns focus.
 */
function PanelColumn(props: {
  children?: ReactNode
  overlay?: boolean
  hidden: boolean
  className: string | undefined
  columnRef?: RefObject<HTMLDivElement>
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = props.columnRef ?? ownRef
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    if (!props.hidden) {
      node.removeAttribute('inert')
      node.removeAttribute('aria-hidden')
      return
    }
    node.setAttribute('inert', '')
    node.setAttribute('aria-hidden', 'true')
  }, [props.hidden])
  return (
    <div ref={ref} className={props.className} data-overlay={props.overlay || undefined} hidden={props.hidden}>
      {props.children}
    </div>
  )
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The four-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const currentSession = useSessions(s => s.current)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  // Frameless desktop shell (preload bridge present): the rail background
  // spans the full window height while the content columns clear the drag
  // strip below (AppFrame.module.css). Absent in browsers and tests, so
  // snapshots never see the attribute.
  const [desktopHost] = useState(
    () => (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop !== undefined,
  )

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
      actions.closeRightbar()
      actions.closeTerminalDrawer()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  // Thread Details never claims a grid track: its toggle opens a fixed card
  // popover, so the center keeps its full width and the card has no resize
  // affordance. The right panel keeps its own concession track.
  const cols = computeColumns(
    viewport,
    sidebarPreference,
    0,
    detailsSession === undefined ? 0 : panels.rightbar,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols

  const detailsOpen = detailsSession !== undefined && panels.details > 0
  const detailsRef = useRef<HTMLDivElement>(null)
  // A click on the toggle or inside the card keeps it open; a click anywhere
  // else dismisses it like any other dropdown.
  useEffect(() => {
    if (!detailsOpen) return
    const onOutside = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node
        && detailsRef.current?.contains(target) !== true
        // The other titlebar toggles are part of the same chrome group: using
        // one must not dismiss the card, so both panels can stay open.
        && !(target instanceof Element && target.closest('[data-panel-toggle]'))) {
        actions.closeDetails()
      }
    }
    document.addEventListener('pointerdown', onOutside)
    return () => { document.removeEventListener('pointerdown', onOutside) }
  }, [actions, detailsOpen])

  // Below the breakpoint the solver closes the right track to keep the center
  // usable; an opened right panel then floats over the conversation.
  const rightbarOverlay = detailsSession !== undefined && panels.rightbar > 0 && cols.rightbar === 0

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onRightbarStart = useCallback(() => { rightbarBase.current = colsRef.current.rightbar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  const productTitle = process.env.GNK_CLIENT_TITLE ?? t('brand.localBuild')
  const panelControls = {
    threadDetailsOpen: panels.details > 0,
    terminalDrawerOpen: panels.terminalDrawerOpen,
    rightPanelOpen: panels.rightbar > 0,
    toggleThreadDetails: () => { actions.toggleDetails() },
    toggleTerminalDrawer: () => { actions.toggleTerminalDrawer() },
    toggleRightPanel: () => { actions.toggleRightbar() },
  }

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.rightbar}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={!detailsOpen || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-open={detailsSession !== undefined && panels.rightbar > 0 || undefined}
      data-dragging={dragging || undefined}
      data-desktop-host={desktopHost || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      {/* Titlebar: brand and session title at the inline start, the three
          panel toggles before the window controls at the reading end (right in
          LTR, far left in RTL), spanning all columns on every host. Browser
          builds keep the native chrome and simply have no window controls to
          clear. */}
      <div className={css.titlebarRow}>
        {renderSlot('titlebar', {
          panelControls, documentTitle, sessionId: currentSession, sidebarCollapsed,
        })}
      </div>
      <div className={css.sidebarCol} hidden={sidebarCollapsed}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; SessionProvider withholds the strict details
            entry while no session is current. */}
        <CenterColumn>
          <div className={css.mainPage} hidden={panels.mainPage !== 'conversation'}>
            {renderSlot('conversation', {})}
          </div>
          {panels.mainPage === 'settings' && (
            <div className={css.mainPage}>
              {renderSlot('settings', { section: panels.settingsSection })}
            </div>
          )}
          {panels.mainPage === 'dashboard' && (
            <div className={css.mainPage}>
              {renderSlot('dashboard', {})}
            </div>
          )}
          {panels.mainPage === 'conversation' && panels.terminalDrawerOpen && detailsSession !== undefined && (
            <div className={css.terminalDrawer} data-terminal-drawer>
              <SessionProvider>
                {renderSlot('terminal.drawer', { close: () => { actions.closeTerminalDrawer() } })}
              </SessionProvider>
            </div>
          )}
        </CenterColumn>
        <DetailsColumn hidden={!detailsOpen} columnRef={detailsRef}>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
        <RightbarColumn overlay={rightbarOverlay} hidden={cols.rightbar === 0 && !rightbarOverlay}>
          <SessionProvider>{renderSlot('rightbar', {})}</SessionProvider>
        </RightbarColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {cols.rightbar > 0 && <DragHandle side="rightbar" left={viewport - cols.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />}
    </div>
  )
}
