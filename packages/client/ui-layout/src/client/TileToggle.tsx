/**
 * Additive frame-overlay control that enters and leaves tiled session mode.
 * Registered as one entry of the existing `shell.overlay` list, so it never
 * replaces another overlay occupant.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@greeneek/gnk-client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import css from './TileToggle.module.css'

/** Full composed props: runtime share + store share + common dictionary. */
export type TileToggleProps =
  & PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/**
 * Render the tiling gesture with the current session as the first pane.
 * @param props - framework runtime, store, and locale shares.
 */
export function TileToggle({ actions, t, useSessions, useStore }: TileToggleProps) {
  const active = useStore(s => s.tilesActive)
  const current = useSessions(s => s.current)
  return (
    <button
      type="button"
      className={css.toggle}
      data-active={active || undefined}
      aria-pressed={active}
      onClick={() => { actions.toggleTiles(current) }}
    >
      {t('tiles.toggle')}
    </button>
  )
}
