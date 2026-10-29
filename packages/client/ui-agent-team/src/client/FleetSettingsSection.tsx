/** Fleet favorites and honest provider availability inside Web Settings. */

import { useEffect, useSyncExternalStore, useState, type FormEvent, type ReactNode } from 'react'
import type {
  FleetFavorite,
  FleetFavoriteMember,
  FleetLaunchResult,
  FleetProviderAvailability,
  FleetProviderState,
  FleetSettings,
} from '@greeneek/gnk-agent-team/client'
import type { RemoteResult } from '@greeneek/gnk-api-remotes/client'
import { Button } from '@greeneek/gnk-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import { NS, type TeamKey } from './locales.ts'
import css from './FleetSettingsSection.module.css'

/** One settings-scope snapshot as consumed by the section. */
export interface FleetSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: FleetSettings | undefined
  readonly revision: number | undefined
  readonly writable: boolean
}

/** Registration-side actions used by the section. */
export interface FleetSettingsInjected {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => FleetSnapshot
  readonly loadAvailability: () => Promise<RemoteResult<FleetProviderAvailability[]>>
  readonly save: (favorites: readonly FleetFavorite[]) => Promise<void>
  readonly launch: (favoriteId: string) => Promise<RemoteResult<FleetLaunchResult>>
  readonly canLaunch: () => boolean
}

/** Full component props assembled by the Settings slot renderer. */
export type FleetSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<FleetSettingsInjected>

type MemberPatch = { [K in keyof FleetFavoriteMember]?: FleetFavoriteMember[K] | undefined }

const EMPTY_MEMBER: FleetFavoriteMember = {
  name: '',
  description: '',
  prompt: '',
  provider: 'spawn',
}

const STATE_KEYS = {
  'not-installed': 'fleet.state.notInstalled',
  unauthenticated: 'fleet.state.unauthenticated',
  'unsupported-version': 'fleet.state.unsupported',
  ready: 'fleet.state.ready',
  'temporarily-unavailable': 'fleet.state.unavailable',
} as const satisfies Record<FleetProviderState, TeamKey>

/** Render one caught value as a message for an inline notice. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Narrow one settings section to the fleet shape. */
export function decodeFleetSettings(section: unknown): FleetSettings | undefined {
  if (typeof section !== 'object' || section === null || !('favorites' in section)) return undefined
  const favorites = (section as { readonly favorites?: unknown }).favorites
  return Array.isArray(favorites) ? section as FleetSettings : undefined
}

/** Derive a stable lower-kebab id from a display name. */
function slug(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 64)
}

/** One member field editor. */
function MemberEditor({ index, member, providers, t, onChange, onRemove }: {
  readonly index: number
  readonly member: FleetFavoriteMember
  readonly providers: readonly FleetProviderAvailability[]
  readonly t: FleetSettingsSectionProps['t']
  readonly onChange: (patch: MemberPatch) => void
  readonly onRemove: () => void
}): ReactNode {
  const scopes = member.writeScopes?.join(', ') ?? ''
  return (
    <fieldset className={css.member}>
      <legend>{t('fleet.member', { index: index + 1 })}</legend>
      <label className={css.field}>
        <span>{t('fleet.memberName')}</span>
        <input
          value={member.name}
          required
          onChange={(event) => { onChange({ name: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span>{t('fleet.memberDescription')}</span>
        <input
          value={member.description}
          required
          onChange={(event) => { onChange({ description: event.target.value }) }}
        />
      </label>
      <label className={css.fieldWide}>
        <span>{t('fleet.memberPrompt')}</span>
        <textarea
          value={member.prompt}
          required
          rows={3}
          onChange={(event) => { onChange({ prompt: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span>{t('fleet.provider')}</span>
        <select
          value={member.provider}
          onChange={(event) => { onChange({ provider: event.target.value }) }}
        >
          {providers.some(provider => provider.name === member.provider)
            ? null
            : <option value={member.provider}>{member.provider} — {t('fleet.state.notInstalled')}</option>}
          {providers.map(provider => (
            <option key={provider.name} value={provider.name} disabled={provider.state !== 'ready'}>
              {provider.name} — {t(STATE_KEYS[provider.state])}
            </option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span>{t('fleet.context')}</span>
        <select
          value={member.context ?? 'fresh'}
          onChange={(event) => { onChange({ context: event.target.value as 'fresh' | 'fork' }) }}
        >
          <option value="fresh">{t('fleet.context.fresh')}</option>
          <option value="fork">{t('fleet.context.fork')}</option>
        </select>
      </label>
      <label className={css.field}>
        <span>{t('fleet.preset')}</span>
        <input
          value={member.preset ?? ''}
          onChange={(event) => { onChange({ preset: event.target.value || undefined }) }}
        />
      </label>
      <label className={css.field}>
        <span>{t('fleet.model')}</span>
        <input
          value={member.model ?? ''}
          onChange={(event) => { onChange({ model: event.target.value || undefined }) }}
        />
      </label>
      <label className={css.field}>
        <span>{t('fleet.effort')}</span>
        <input
          value={member.reasoningEffort ?? ''}
          onChange={(event) => { onChange({ reasoningEffort: event.target.value || undefined }) }}
        />
      </label>
      <label className={css.field}>
        <span>{t('fleet.budget')}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={member.maxTokens ?? ''}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            onChange({ maxTokens: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined })
          }}
        />
      </label>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={member.readOnly === true}
          onChange={(event) => { onChange({ readOnly: event.target.checked || undefined }) }}
        />
        <span>{t('fleet.readOnly')}</span>
      </label>
      <label className={css.field}>
        <span>{t('fleet.writeScopes')}</span>
        <input
          value={scopes}
          disabled={member.readOnly === true}
          onChange={(event) => {
            const next = [...new Set(event.target.value.split(',').map(value => value.trim()).filter(Boolean))]
            onChange({ writeScopes: next.length === 0 ? undefined : next })
          }}
        />
      </label>
      <Button variant="outline" onClick={onRemove}>{t('fleet.removeMember')}</Button>
    </fieldset>
  )
}

/**
 * Render provider availability and the named favorite editor.
 * @param props - settings section runtime, localized copy, and injected fleet actions.
 * @returns the fleet settings page.
 */
export function FleetSettingsSection({
  t, subscribe, getSnapshot, loadAvailability, save, launch, canLaunch,
}: FleetSettingsSectionProps): ReactNode {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [providers, setProviders] = useState<readonly FleetProviderAvailability[]>([])
  const [draft, setDraft] = useState<FleetFavorite | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingLaunch, setPendingLaunch] = useState<FleetFavorite | null>(null)
  const favorites = snapshot.value?.favorites ?? []
  useEffect(() => { void refreshAvailability() }, [])
  const writable = snapshot.writable && snapshot.status === 'ready'

  const refreshAvailability = async (): Promise<void> => {
    const result = await loadAvailability()
    if (result.ok) setProviders(result.value)
    else setNotice(t('fleet.error', { message: result.error.message }))
  }

  const openNew = (): void => {
    setDraft({ id: '', name: '', members: [{ ...EMPTY_MEMBER, provider: providers.find(p => p.state === 'ready')?.name ?? 'spawn' }] })
    setNotice(null)
  }

  const openEdit = (favorite: FleetFavorite): void => {
    setDraft(structuredClone(favorite))
    setNotice(null)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    /* v8 ignore next -- the form exists only while a draft is open. */
    if (draft === null) return
    const favorite: FleetFavorite = {
      ...draft,
      id: draft.id.trim() === '' ? slug(draft.name) : draft.id.trim(),
    }
    setBusy(true)
    try {
      const next = favorites.some(candidate => candidate.id === favorite.id)
        ? favorites.map(candidate => candidate.id === favorite.id ? favorite : candidate)
        : [...favorites, favorite]
      await save(next)
      setDraft(null)
      setNotice(t('fleet.saved'))
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (favorite: FleetFavorite): Promise<void> => {
    setBusy(true)
    try {
      await save(favorites.filter(candidate => candidate.id !== favorite.id))
      setNotice(t('fleet.deleted'))
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    } finally {
      setBusy(false)
    }
  }

  const confirmLaunch = async (): Promise<void> => {
    /* v8 ignore next -- the confirmation exists only while a favorite is pending. */
    if (pendingLaunch === null) return
    setBusy(true)
    try {
      const result = await launch(pendingLaunch.id)
      if (!result.ok) {
        setNotice(t('fleet.error', { message: result.error.message }))
      } else if (!result.value.ok) {
        setNotice(t('fleet.error', { message: result.value.error.message }))
      } else {
        setNotice(t('fleet.launched', { count: result.value.value.members.length }))
      }
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    } finally {
      setBusy(false)
      setPendingLaunch(null)
      await refreshAvailability()
    }
  }

  if (snapshot.status === 'loading') return <p className={css.status}>{t('fleet.loading')}</p>
  if (snapshot.status === 'unavailable' || !writable) {
    return (
      <section className={css.root}>
        <h2 className={css.title}>{t('fleet.title')}</h2>
        <p className={css.status}>{t('fleet.unavailable')}</p>
        <Button variant="outline" onClick={() => { void refreshAvailability() }}>{t('fleet.refresh')}</Button>
        {providers.length > 0 && (
          <ul className={css.providers}>
            {providers.map(provider => (
              <li key={provider.name} data-state={provider.state}>{provider.name} — {t(STATE_KEYS[provider.state])}</li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section className={css.root}>
      <header className={css.header}>
        <div>
          <h2 className={css.title}>{t('fleet.title')}</h2>
          <p className={css.description}>{t('fleet.description')}</p>
        </div>
        <Button variant="outline" onClick={() => { void refreshAvailability() }}>{t('fleet.refresh')}</Button>
      </header>

      <h3 className={css.subtitle}>{t('fleet.availability')}</h3>
      <ul className={css.providers} aria-label={t('fleet.availability')}>
        {providers.map(provider => (
          <li key={provider.name} data-state={provider.state}>
            <strong>{provider.name}</strong>
            <span>{t(STATE_KEYS[provider.state])}</span>
            {provider.detail !== undefined && <small>{provider.detail}</small>}
          </li>
        ))}
      </ul>

      <div className={css.favoriteHeader}>
        <h3 className={css.subtitle}>{t('fleet.favorites')}</h3>
        <Button variant="primary" disabled={busy} onClick={openNew}>{t('fleet.new')}</Button>
      </div>
      {favorites.length === 0
        ? <p className={css.status}>{t('fleet.empty')}</p>
        : (
          <ul className={css.favorites}>
            {favorites.map(favorite => (
              <li key={favorite.id} className={css.favorite}>
                <div className={css.favoriteText}>
                  <strong>{favorite.name}</strong>
                  <span>{t('fleet.memberCount', { count: favorite.members.length })}</span>
                  <span className={css.memberSummary}>
                    {favorite.members.map(member => member.provider).join(', ')}
                  </span>
                </div>
                <div className={css.actions}>
                  <Button variant="outline" disabled={busy} onClick={() => { openEdit(favorite) }}>{t('fleet.edit')}</Button>
                  <Button
                    variant="outline"
                    disabled={busy || !canLaunch()}
                    title={canLaunch() ? undefined : t('fleet.needSession')}
                    onClick={() => { setPendingLaunch(favorite) }}
                  >
                    {t('fleet.launch')}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => { void remove(favorite) }}>{t('fleet.delete')}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}

      {pendingLaunch !== null && (
        <div className={css.confirm} role="alertdialog" aria-label={t('fleet.confirmTitle')}>
          <h3>{t('fleet.confirmTitle')}</h3>
          <p>{t('fleet.confirmBody', { name: pendingLaunch.name })}</p>
          <ul>
            {pendingLaunch.members.map(member => (
              <li key={member.name}>
                {member.name}: {member.provider}, {member.preset ?? t('fleet.inherited')},
                {' '}{member.model ?? t('fleet.inherited')},
                {' '}{member.reasoningEffort ?? t('fleet.inherited')},
                {' '}{member.maxTokens === undefined ? t('fleet.unbounded') : t('fleet.tokens', { count: member.maxTokens })},
                {' '}{member.readOnly === true
                  ? t('fleet.readOnly')
                  : member.writeScopes === undefined || member.writeScopes.length === 0
                    ? t('fleet.sharedCheckout')
                    : t('fleet.scopes', { scopes: member.writeScopes.join(', ') })}
              </li>
            ))}
          </ul>
          <div className={css.actions}>
            <Button variant="outline" disabled={busy} onClick={() => { setPendingLaunch(null) }}>{t('fleet.cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void confirmLaunch() }}>{t('fleet.confirm')}</Button>
          </div>
        </div>
      )}

      {draft !== null && (
        <form className={css.editor} onSubmit={(event) => { void submit(event) }}>
          <h3 className={css.subtitle}>{t('fleet.editorTitle')}</h3>
          <label className={css.field}>
            <span>{t('fleet.favoriteName')}</span>
            <input
              value={draft.name}
              required
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('fleet.favoriteId')}</span>
            <input
              value={draft.id}
              placeholder={slug(draft.name)}
              onChange={(event) => { setDraft({ ...draft, id: event.target.value }) }}
            />
          </label>
          {draft.members.map((member, index) => (
            <MemberEditor
              key={index}
              index={index}
              member={member}
              providers={providers}
              t={t}
              onChange={(patch) => {
                const members = draft.members.map((candidate, memberIndex) => {
                  if (memberIndex !== index) return candidate
                  return Object.fromEntries(
                    Object.entries({ ...candidate, ...patch }).filter(([, value]) => value !== undefined),
                  ) as unknown as FleetFavoriteMember
                })
                setDraft({ ...draft, members })
              }}
              onRemove={() => {
                setDraft({ ...draft, members: draft.members.filter((_candidate, memberIndex) => memberIndex !== index) })
              }}
            />
          ))}
          <div className={css.actions}>
            <Button
              variant="outline"
              onClick={() => {
                setDraft({
                  ...draft,
                  members: [...draft.members, { ...EMPTY_MEMBER, provider: providers.find(p => p.state === 'ready')?.name ?? 'spawn' }],
                })
              }}
            >
              {t('fleet.addMember')}
            </Button>
            <Button variant="primary" type="submit" disabled={busy || draft.members.length === 0}>{t('fleet.save')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setDraft(null) }}>{t('fleet.cancel')}</Button>
          </div>
        </form>
      )}

      {notice !== null && <p className={css.notice} role="status">{notice}</p>}
    </section>
  )
}
