/**
 * Tiled session panes. Each pane is a real app page in a same-origin iframe,
 * so it keeps its own live session, composer, and transcript; geometry and
 * per-pane selection come from the shared layout store and survive reload.
 * Pure component: all state and callbacks arrive through the framework shares.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@greeneek/gnk-client-ui-slots'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { createLayoutStore, SessionTile } from './stores.ts'
import css from './SessionTiles.module.css'

/** Full composed props: runtime share + store share + common dictionary. */
export type SessionTilesProps =
  & PropsRuntime<'session.tiles'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

interface DragOrigin {
  id: string
  mode: 'move' | 'resize'
  x: number
  y: number
  w: number
  h: number
  px: number
  py: number
}

/** Page URL selecting one pane's session without disturbing the parent page. */
function tileUrl(tile: SessionTile): string {
  const url = new URL(location.href)
  url.searchParams.set('tile', tile.id)
  if (tile.sessionId === undefined) url.searchParams.delete('session')
  else url.searchParams.set('session', tile.sessionId)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Render persisted, resizable, repositionable session panes.
 * @param props - framework runtime, store, and locale shares.
 */
export function SessionTiles({ actions, t, useSessions, useStore }: SessionTilesProps) {
  const tiles = useStore(s => s.tiles)
  const titles = useSessions(s => s.byId)
  const current = useSessions(s => s.current)
  const container = useRef<HTMLDivElement>(null)
  const origin = useRef<DragOrigin | undefined>(undefined)

  const start = (event: ReactPointerEvent, tile: SessionTile, mode: DragOrigin['mode']): void => {
    // Header buttons keep their click gesture; only the header chrome drags.
    if (mode === 'move' && (event.target as HTMLElement).closest('button') !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = { id: tile.id, mode, x: tile.x, y: tile.y, w: tile.w, h: tile.h, px: event.clientX, py: event.clientY }
  }

  const follow = (event: ReactPointerEvent): void => {
    const active = origin.current
    const bounds = container.current?.getBoundingClientRect()
    if (active === undefined || bounds === undefined || bounds.width === 0 || bounds.height === 0) return
    const dx = (event.clientX - active.px) / bounds.width
    const dy = (event.clientY - active.py) / bounds.height
    if (active.mode === 'move') actions.moveTile(active.id, active.x + dx, active.y + dy)
    else actions.resizeTile(active.id, active.w + dx, active.h + dy)
  }

  const stop = (event: ReactPointerEvent): void => {
    if (origin.current === undefined) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    origin.current = undefined
  }

  const move = (tile: SessionTile, to: number): void => {
    actions.reorderTile(tile.id, to)
  }

  return (
    <div className={css.root} ref={container} data-tiles={tiles.length}>
      {tiles.map((tile, index) => (
        <section
          key={tile.id}
          className={css.tile}
          data-tile={tile.id}
          style={{
            left: `${tile.x * 100}%`,
            top: `${tile.y * 100}%`,
            width: `${tile.w * 100}%`,
            height: `${tile.h * 100}%`,
          }}
        >
          <header
            className={css.header}
            onPointerDown={(event) => { start(event, tile, 'move') }}
            onPointerMove={follow}
            onPointerUp={stop}
            onPointerCancel={stop}
          >
            <span className={css.title}>
              {tile.sessionId === undefined ? t('tiles.unnamed') : titles[tile.sessionId as SessionId]?.title ?? t('tiles.unnamed')}
            </span>
            <button type="button" className={css.action} aria-label={t('tiles.add')} disabled={tiles.length >= 4} onClick={() => { actions.addTile(current) }}>+</button>
            <button type="button" className={css.action} aria-label={t('tiles.moveEarlier')} disabled={index === 0} onClick={() => { move(tile, index - 1) }}>‹</button>
            <button type="button" className={css.action} aria-label={t('tiles.moveLater')} disabled={index === tiles.length - 1} onClick={() => { move(tile, index + 1) }}>›</button>
            <button type="button" className={css.action} aria-label={t('tiles.close')} onClick={() => { actions.removeTile(tile.id) }}>×</button>
          </header>
          <iframe
            className={css.frame}
            src={tileUrl(tile)}
            title={tile.sessionId === undefined
              ? t('tiles.pane', { id: tile.id })
              : titles[tile.sessionId as SessionId]?.title ?? t('tiles.pane', { id: tile.id })}
          />
          <div
            className={css.resize}
            role="separator"
            tabIndex={0}
            aria-label={t('tiles.resize')}
            aria-orientation="vertical"
            onKeyDown={(event) => {
              const step = 0.05
              if (event.key === 'ArrowRight') actions.resizeTile(tile.id, tile.w + step, tile.h)
              else if (event.key === 'ArrowLeft') actions.resizeTile(tile.id, tile.w - step, tile.h)
              else if (event.key === 'ArrowDown') actions.resizeTile(tile.id, tile.w, tile.h + step)
              else if (event.key === 'ArrowUp') actions.resizeTile(tile.id, tile.w, tile.h - step)
              else return
              event.preventDefault()
            }}
            onPointerDown={(event) => { start(event, tile, 'resize') }}
            onPointerMove={follow}
            onPointerUp={stop}
            onPointerCancel={stop}
          />
        </section>
      ))}
    </div>
  )
}
