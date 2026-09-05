/**
 * One provider's model-visibility panel: which of this route's models the
 * selectors offer. A visibility preference, not a catalog edit — toggling a
 * model off records its id in the profile's `hiddenModels`, and the model
 * stays configured and routable. The list unions the endpoint (or installed)
 * catalog with already-hidden ids, so a hide whose model left the catalog can
 * still be undone here instead of stranding an uneditable entry in settings.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  LlmDiscoveredModel, SettingsNamespaceView,
} from '@greeneek/gnk-api-remotes/client'
import { Button, Modal } from '@greeneek/gnk-client-ui-primitives'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The provider route whose model visibility this panel edits. */
export interface ModelVisibilityTarget {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
  /** Owning settings namespace. */
  settingsNs: string
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
}

/** Props of {@link ModelVisibilityPanel}. */
export interface ModelVisibilityPanelProps {
  /** The addressed provider route. */
  target: ModelVisibilityTarget
  /** The owning namespace view (schema, layers, secrets). */
  namespace: SettingsNamespaceView
  /** Settings-owned synchronous schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** The Host operations this panel reads and writes through. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the panel; `changed` reports whether a save committed. */
  onClose: (changed: boolean) => void
}

/**
 * Read the stored hidden-model ids for one profile: a string array, or empty
 * when the profile names none (anything else is not this panel's write and is
 * left for the settings document, never reinterpreted here).
 * @param schema - settings-owned schema reads.
 * @param namespace - the owning namespace view.
 * @param settingsPath - path from the section root to the profile.
 * @returns the stored hidden ids.
 */
function storedHiddenIds(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  settingsPath: readonly string[],
): readonly string[] {
  const profile = schema.getPath(namespace.user, settingsPath)
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return []
  const hidden = (profile as { hiddenModels?: unknown }).hiddenModels
  if (!Array.isArray(hidden)) return []
  return hidden.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Render one provider's model-visibility panel.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the modal panel.
 */
export function ModelVisibilityPanel(props: ModelVisibilityPanelProps): ReactNode {
  const { target, namespace, schema, operations, t } = props
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(storedHiddenIds(schema, namespace, target.settingsPath)),
  )
  const [models, setModels] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [loadFailure, setLoadFailure] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailure, setSaveFailure] = useState<string | undefined>(undefined)
  const disabled = props.readOnly || saving

  useEffect(() => {
    let stale = false
    setModels(undefined)
    setLoadFailure(undefined)
    void operations.discoverModels(target.settingsNs, { provider: target.provider }).then((answer) => {
      if (stale) return
      if (answer.kind === 'refused') {
        setLoadFailure(answer.message)
        return
      }
      const listed = new Map(answer.models.map(model => [model.id, model]))
      for (const id of storedHiddenIds(schema, namespace, target.settingsPath)) {
        if (!listed.has(id)) listed.set(id, { id })
      }
      setModels([...listed.values()])
    })
    return () => { stale = true }
  }, [operations, schema, namespace, target.settingsNs, target.provider, target.settingsPath, attempt])

  const toggle = (id: string): void => {
    setHidden((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const normalizedQuery = query.trim().toLowerCase()
  const visible = (models ?? []).filter(model => normalizedQuery.length === 0
    || model.id.toLowerCase().includes(normalizedQuery)
    || model.name?.toLowerCase().includes(normalizedQuery) === true)
  const unchanged = (() => {
    const initial = storedHiddenIds(schema, namespace, target.settingsPath)
    return initial.length === hidden.size && initial.every(id => hidden.has(id))
  })()

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveFailure(undefined)
    try {
      const written = await operations.writeSettings(
        target.settingsNs,
        [{ op: 'set', path: [...target.settingsPath, 'hiddenModels'], value: [...hidden] }],
        namespace.revision,
      )
      if (written.kind !== 'written') {
        setSaveFailure(written.kind === 'conflict' ? t('conflict') : written.message)
        return
      }
      props.onClose(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => { props.onClose(false) }}
      title={t('models')}
      closeLabel={t('close')}
      description={t('visibilityDescription').replace('{provider}', () => target.displayName)}
      className={styles['visibilityDialog'] as string}
      footer={(
        <>
          <Button variant="outline" onClick={() => { props.onClose(false) }}>{t('cancel')}</Button>
          <Button variant="outline" disabled={disabled || unchanged || models === undefined} onClick={() => { void save() }}>
            {saving ? t('applying') : t('apply')}
          </Button>
        </>
      )}
    >
      {loadFailure !== undefined
        ? (
          <div className={styles['visibilityStatus']}>
            <p className={styles['error']}>{loadFailure}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAttempt(current => current + 1) }}
            >
              {t('retry')}
            </Button>
          </div>
        )
        : models === undefined
          ? <p className={styles['visibilityStatus']} role="status">{t('fetching')}</p>
          : models.length === 0
            ? <p className={styles['visibilityStatus']} role="status">{t('visibilityEmpty')}</p>
            : (
              <>
                <div className={styles['candidateToolbar']}>
                  <input
                    className={`${styles['input']} ${styles['candidateSearch']}`}
                    type="search"
                    value={query}
                    placeholder={t('fetchSearch')}
                    aria-label={t('fetchSearch')}
                    onChange={(event) => { setQuery(event.target.value) }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || visible.every(model => !hidden.has(model.id))}
                    onClick={() => { setHidden(new Set()) }}
                  >
                    {t('visibilityShowAll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || visible.every(model => hidden.has(model.id))}
                    onClick={() => { setHidden(new Set([...hidden, ...visible.map(model => model.id)])) }}
                  >
                    {t('visibilityHideAll')}
                  </Button>
                </div>
                {visible.length === 0
                  ? <p className={styles['candidateEmpty']} role="status">{t('fetchNoMatches')}</p>
                  : (
                    <>
                      <h3 className={styles['visibilityGroup']}>{target.displayName}</h3>
                      <ul className={styles['visibilityList']}>
                        {visible.map((model) => {
                          const off = hidden.has(model.id)
                          return (
                            <li key={model.id} className={styles['visibilityRow']}>
                              <span className={styles['visibilityIdentity']}>
                                <span className={styles['visibilityName']}>{model.name ?? model.id}</span>
                                {model.name === undefined || model.name === model.id
                                  ? null
                                  : <span className={styles['visibilityId']}>{model.id}</span>}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!off}
                                aria-label={model.name ?? model.id}
                                disabled={disabled}
                                className={off ? styles['visibilitySwitch'] : `${styles['visibilitySwitch']} ${styles['visibilitySwitchOn']}`}
                                onClick={() => { toggle(model.id) }}
                              >
                                <span className={styles['visibilityThumb']} />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
              </>
            )}
      {saveFailure === undefined ? null : <p className={styles['error']}>{saveFailure}</p>}
    </Modal>
  )
}
