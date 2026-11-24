/**
 * Plugins page: only plugins the user created or installed, grouped into
 * Skills, MCP, and Installed categories. Refresh, Add plugin split button,
 * creator-mode action, and the registry dialog stay available.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import { SettingsSectionHeader, TabBar } from '@greeneek/gnk-client-ui-primitives'
import css from './PluginManagerSection.module.css'

/** One plugin entry as the page sees it. */
export interface PluginEntryView {
  readonly moduleName: string
  readonly enabled: boolean
}

/** Registration-side Remote face. */
export interface PluginManagerInjected {
  /** Read the current Host plugin inventory. */
  list: () => Promise<readonly PluginEntryView[]>
  /** Open a session seeded with a plugin-creation prompt. */
  createWithAgent: () => void
  /** Return to the conversation. */
  close: () => void
}

export type PluginManagerSectionProps =
  PropsRuntime<'plugins'>
  & PropsLocale<'settings.pluginManager'>
  & InjectFace<PluginManagerInjected>

type Registry = 'official' | 'mainland' | 'custom'
type Category = 'skills' | 'mcp' | 'installed'

/** Validate a custom registry address. */
function validRegistry(value: string): boolean {
  return /^https?:\/\/.+/.test(value.trim())
}

/** Classify a user plugin entry by its module name. */
function categoryOf(moduleName: string): Category {
  const name = moduleName.toLowerCase()
  if (name.includes('mcp')) return 'mcp'
  if (name.includes('skill')) return 'skills'
  return 'installed'
}

/** Whether an inventory entry is a user plugin rather than a shipped one. */
function isUserPlugin(moduleName: string): boolean {
  return !moduleName.startsWith('@greeneek/') && !moduleName.startsWith('cordis:')
}

/** Render the Plugins page. */
export function PluginManagerSection(props: PluginManagerSectionProps) {
  const { t, list, createWithAgent, close } = props
  const [entries, setEntries] = useState<readonly PluginEntryView[]>([])
  const [category, setCategory] = useState<Category>('installed')
  const [error, setError] = useState<string>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [name, setName] = useState('')
  const [registry, setRegistry] = useState<Registry>('official')
  const [custom, setCustom] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError(undefined)
      const all = await list()
      setEntries(all.filter(entry => isUserPlugin(entry.moduleName)))
    } catch {
      setError(t('loadFailed'))
    }
  }, [list, t])

  useEffect(() => { void refresh() }, [refresh])

  const visible = useMemo(
    () => entries.filter(entry => categoryOf(entry.moduleName) === category),
    [entries, category],
  )

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

  return (
    <div className={css.root}>
      <SettingsSectionHeader
        title={t('title')}
        intro={t('intro')}
        closeLabel={t('close')}
        onClose={close}
        actionsClassName={css.toolbar}
      >
        <button type="button" className={css.secondary} onClick={() => { void refresh() }}>{t('refresh')}</button>
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
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); createWithAgent() }}>
                <span>{t('createWithAgent')}</span>
                <span className={css.menuDescription}>{t('createWithAgentHint')}</span>
              </button>
            </div>
          )}
        </div>
      </SettingsSectionHeader>
      {error !== undefined && <p className={css.error} role="alert">{error} <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></p>}

      <TabBar
        tabs={(['skills', 'mcp', 'installed'] as const).map(id => ({
          id,
          label: t(`category${id.charAt(0).toUpperCase()}${id.slice(1)}` as 'categorySkills'),
        }))}
        activeId={category}
        onSelect={setCategory}
      />

      {visible.length === 0
        ? (
          <div className={css.empty}>
            <p>{t(`empty${category.charAt(0).toUpperCase()}${category.slice(1)}` as 'emptySkills')}</p>
            <button type="button" onClick={createWithAgent}>{t('createWithAgent')}</button>
          </div>
        )
        : (
          <div className={css.list}>
            {visible.map(entry => (
              <div key={entry.moduleName} className={css.row}>
                <span className={css.rowName}>{entry.moduleName}</span>
                <span className={entry.enabled ? css.badgeOn : css.badgeOff}>{entry.enabled ? t('statusEnabled') : t('statusDisabled')}</span>
              </div>
            ))}
          </div>
        )}

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
