/** Tab strip whose labels stay owned by the locale of the calling surface. */
import css from './TabBar.module.css'

/** One tab: a stable id and an already-localized label. */
export interface TabBarTab<T extends string> {
  readonly id: T
  readonly label: string
}

/**
 * Render a tab list from owner-supplied tabs.
 * @param props.tabs - tabs in display order.
 * @param props.activeId - id of the selected tab.
 * @param props.onSelect - called with the id of the activated tab.
 * @returns the tablist element.
 */
export function TabBar<T extends string>({ tabs, activeId, onSelect }: {
  tabs: readonly TabBarTab<T>[]
  activeId: T
  onSelect: (id: T) => void
}) {
  return (
    <div className={css.tabs} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeId === tab.id}
          className={activeId === tab.id ? css.tabActive : css.tab}
          onClick={() => { onSelect(tab.id) }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
