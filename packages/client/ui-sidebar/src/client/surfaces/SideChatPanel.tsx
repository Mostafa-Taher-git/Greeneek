/**
 * Side Chat surface: a forked, independent Session created from the current
 * thread. The fork is real (the Host Session Controller performs it); the panel
 * offers a way to bring that thread into the main conversation.
 */
import type { SideChatSurfaceProps } from './contract.ts'
import css from './SideChatPanel.module.css'

/**
 * Render the forked side thread.
 * @param props - child id, open callback, locale.
 * @returns the side-session actions.
 */
export function SideChatPanel({ childId, open, t }: SideChatSurfaceProps) {
  return (
    <div className={css.root}>
      <h3 className={css.heading}>{t('surface.sideChat')}</h3>
      <p className={css.text}>{t('sideChat.created')}</p>
      <code className={css.id}>{childId}</code>
      <button type="button" className={css.action} onClick={() => { open(childId) }}>
        {t('sideChat.open')}
      </button>
    </div>
  )
}
