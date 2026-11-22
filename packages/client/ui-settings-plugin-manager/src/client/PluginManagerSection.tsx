/**
 * Plugins settings section: built-in plugin settings, experimental plugins,
 * a refresh control, an Add plugin split button with an install dialog, a
 * registry selector, and a trust warning. Inventory data comes from the Host
 * plugin-inventory Remote; installation is read-only in this build.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import css from './PluginManagerSection.module.css'

/** One plugin entry as the section sees it. */
export interface PluginEntryView {
  readonly moduleName: string
  readonly enabled: boolean
}

/** Registration-side Remote face. */
export interface PluginManagerInjected {
  /** Read the current Host plugin inventory. */
  list: () => Promise<readonly PluginEntryView[]>
  /** Navigate to the Built-in plugins settings section. */
  openBuiltIn: () => void
}

export type PluginManagerSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginManager'>
  & InjectFace<PluginManagerInjected>

type Registry = 'official' | 'mainland' | 'custom'

/** Whether an inventory entry is an experimental plugin. */
function isExperimental(moduleName: string): boolean {
  return moduleName.includes('experimental')
}

/** Validate a custom registry address. */
function validRegistry(value: string): boolean {
  return /^https?:\/\/.+/.test(value.trim())
}

/** Render the Plugins section. */
export function PluginManagerSection(props: PluginManagerSectionProps) {
  const { t, list, openBuiltIn } = props
  const [entries, setEntries] = useState<readonly PluginEntryView[]>([])
  const [error, setError] = useState<string>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [name, setName] = useState('')
  const [registry, setRegistry] = useState<Registry>('official')
  const [custom, setCustom] = useState('')
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() => new Set())

  const refresh = useCallback(async () => {
    try {
      setError(undefined)
      setEntries(await list())
    } catch {
      setError(t('loadFailed'))
    }
  }, [list, t])

  useEffect(() => { void refresh() }, [refresh])

  const builtIn = useMemo(() => entries.filter(entry => !isExperimental(entry.moduleName)), [entries])
  const experimental = useMemo(() => entries.filter(entry => isExperimental(entry.moduleName)), [entries])

  const customInvalid = registry === 'custom' && !validRegistry(custom)

  const openDialog = (): void => {
    setMenuOpen(false)
    setNotice(undefined)
    setDialogOpen(true)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (name.trim().length === 0 || customInvalid) return
    setNotice(t('installUnavailable'))
  }

  const toggle = (moduleName: string): void => {
    setEnabled((current) => {
      const next = new Set(current)
      if (next.has(moduleName)) next.delete(moduleName)
      else next.add(moduleName)
      return next
    })
  }

  return (
    <div className={css.root}>
      <div className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <div className={css.toolbar}>
          <button type="button" className={css.secondary} disabled={false} onClick={() => { void refresh() }}>{t('refresh')}</button>
          <div className={css.addWrap}>
            <button type="button" className={css.primary} onClick={openDialog}>{t('addPlugin')}</button>
            <button
              type="button"
              className={css.primaryCaret}
              aria-label={t('chooseAddMethod')}
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen(value => !value) }}
            >▾</button>
            {menuOpen && (
              <div className={css.menu} role="menu">
                <button type="button" role="menuitem" onClick={openDialog}>
                  <span>{t('installExisting')}</span>
                  <span className={css.menuDescription}>{t('installExistingDescription')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className={css.intro}>{t('intro')}</p>
      {error !== undefined && <p className={css.error} role="alert">{error} <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></p>}

      <section className={css.card}>
        <h3 className={css.sectionTitle}>{t('builtInTitle')}</h3>
        <p className={css.sectionHint}>{t('builtInHint')}</p>
        <button type="button" className={css.secondary} onClick={openBuiltIn}>{t('openBuiltIn')}</button>
        <ul className={css.list}>
          {builtIn.map(entry => (
            <li key={entry.moduleName} className={css.row}>
              <span className={css.rowName}>{entry.moduleName}</span>
              <span className={css.badgeOff}>{t('sourceBuiltIn')}</span>
              <span className={entry.enabled ? css.badgeOn : css.badgeOff}>{entry.enabled ? t('statusEnabled') : t('statusDisabled')}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.card}>
        <h3 className={css.sectionTitle}>{t('experimentalTitle')}</h3>
        <p className={css.sectionHint}>{t('experimentalHint')}</p>
        {experimental.length === 0
          ? <p className={css.sectionHint}>{t('noExperimental')}</p>
          : (
            <ul className={css.list}>
              {experimental.map(entry => (
                <li key={entry.moduleName} className={css.row}>
                  <span className={css.rowName}>{entry.moduleName}</span>
                  <label className={css.toggle}>
                    <input
                      type="checkbox"
                      checked={enabled.has(entry.moduleName) || entry.enabled}
                      onChange={() => { toggle(entry.moduleName) }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
      </section>

      {dialogOpen && (
        <div className={css.backdrop}>
          <form className={css.dialog} role="dialog" aria-modal="true" onSubmit={submit}>
            <h3 className={css.sectionTitle}>{t('addPlugin')}</h3>
            <label className={css.field}>
              <span>{t('packageName')}</span>
              <input value={name} placeholder={t('packageNamePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
              <span className={css.fieldHint}>{t('packageNameHint')}</span>
            </label>
            <fieldset className={css.fieldset}>
              <legend>{t('registry')}</legend>
              <label className={css.radio}><input type="radio" name="registry" checked={registry === 'official'} onChange={() => { setRegistry('official') }} />{t('registryOfficial')}</label>
              <label className={css.radio}><input type="radio" name="registry" checked={registry === 'mainland'} onChange={() => { setRegistry('mainland') }} />{t('registryMainland')}</label>
              <label className={css.radio}><input type="radio" name="registry" checked={registry === 'custom'} onChange={() => { setRegistry('custom') }} />{t('registryCustom')}</label>
              {registry === 'custom' && (
                <label className={css.field}>
                  <input value={custom} placeholder={t('registryCustomPlaceholder')} onChange={(event) => { setCustom(event.target.value) }} />
                  <span className={css.fieldHint}>{t('registryCustomHint')}</span>
                  {customInvalid && <span className={css.error} role="alert">{t('registryCustomInvalid')}</span>}
                </label>
              )}
            </fieldset>
            <p className={css.warning} role="note">{t('trustWarning')}</p>
            {notice !== undefined && <p className={css.notice} role="status">{notice}</p>}
            <div className={css.dialogActions}>
              <button type="button" className={css.secondary} onClick={() => { setDialogOpen(false) }}>{t('cancel')}</button>
              <button type="submit" className={css.primary} disabled={name.trim().length === 0 || customInvalid}>{t('add')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
