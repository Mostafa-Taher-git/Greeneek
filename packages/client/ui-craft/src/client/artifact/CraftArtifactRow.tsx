/**
 * Craft artifact tool card — the keyed toolview for bridge tools that write
 * files (`mcp__<app>__<artifact tool>`). Collapsed by default: one accent row
 * naming the app tool, its artifact count, and a chip per confined path. The
 * app's own first text line rides below so a failure stays readable without
 * opening the trajectory details.
 */
import { StateDot } from '@greeneek/gnk-client-ui-primitives'
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import type { ToolCallViewProps } from '@greeneek/gnk-client-ui-tool/client'
import { artifactModel, basename, type CraftArtifactState } from './model.ts'
import css from './CraftArtifactRow.module.css'

type CraftArtifactRowProps = ToolCallViewProps & PropsLocale<'craft'>

/** Map the card lifecycle onto the shared state dot vocabulary. */
function dotState(state: CraftArtifactState): 'ongoing' | 'done' | 'error' {
  switch (state) {
    case 'running': return 'ongoing'
    case 'error': return 'error'
    default: return 'done'
  }
}

/**
 * Render one Craft artifact-bearing tool call.
 * @param props - keyed toolview payload plus the craft locale seat.
 * @returns the artifact card.
 */
export function CraftArtifactRow({ block, toolName, openFile, t }: CraftArtifactRowProps) {
  const model = artifactModel(block)
  return (
    <div className={css.card} data-tool={toolName} data-state={model.state}>
      <div className={css.head}>
        <StateDot state={dotState(model.state)} />
        <span className={css.title}>{t('artifact.title')}</span>
        {model.artifacts.length === 0 ? null : (
          <span className={css.count}>{t('artifact.count', { count: model.artifacts.length })}</span>
        )}
        {model.state === 'running' ? (
          <span className={css.status} role="status">{t('artifact.running')}</span>
        ) : null}
        {model.state === 'error' ? (
          <span className={`${css.status} ${css.failed}`} role="alert">{t('artifact.failed')}</span>
        ) : null}
        {model.state === 'ok' && model.artifacts.length === 0 ? (
          <span className={css.status} role="status">{t('artifact.empty')}</span>
        ) : null}
      </div>
      {model.summary === null ? null : (
        <p className={css.summary} data-error={model.state === 'error' || undefined}>{model.summary}</p>
      )}
      {model.artifacts.length === 0 ? null : (
        <ul className={css.chips}>
          {model.artifacts.map(path => (
            <li key={path}>
              <button
                type="button"
                className={css.chip}
                title={path}
                aria-label={t('artifact.openAria', { name: basename(path) })}
                onClick={() => { openFile(path) }}
              >
                {basename(path)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
