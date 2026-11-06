/** Fleet favorites and honest provider availability inside Web Settings. */

import { useEffect, useSyncExternalStore, useState, type FormEvent, type ReactNode } from 'react'
import type {
  FleetFavorite,
  FleetFavoriteMember,
  FleetFavoriteResult,
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
  readonly loadStarters: () => Promise<RemoteResult<readonly FleetFavorite[]>>
  readonly save: (favorites: readonly FleetFavorite[]) => Promise<void>
  readonly launch: (favoriteId: string) => Promise<RemoteResult<FleetLaunchResult>>
  readonly duplicate: (favoriteId: string) => Promise<RemoteResult<FleetFavoriteResult>>
  readonly installStarter: (templateId: string) => Promise<RemoteResult<FleetFavoriteResult>>
  readonly canLaunch: () => boolean
}

/** Full component props assembled by the Settings slot renderer. */
export type FleetSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<FleetSettingsInjected>

type MemberPatch = { [K in keyof FleetFavoriteMember]?: FleetFavoriteMember[K] | undefined }

/**
 * Provider states a fleet member may be assigned to. `ready` holds a durable lane
 * with mailbox, interruption, and recovery; `one-shot` runs one delegation that
 * settles with a result, which the roster dispatches from the same registry, so a
 * mixed fleet of in-harness lanes and external agents is editable here.
 */
const SELECTABLE_STATES: ReadonlySet<FleetProviderState> = new Set(['ready', 'one-shot'])

/**
 * Provider a newly added member starts on, preferring one that holds a durable lane.
 * @param providers - availability rows loaded for this composition.
 * @returns a selectable provider name, or the composition's `spawn` default.
 */
function defaultProvider(providers: readonly FleetProviderAvailability[]): string {
  return providers.find(provider => provider.state === 'ready')?.name
    ?? providers.find(provider => SELECTABLE_STATES.has(provider.state))?.name
    ?? 'spawn'
}

const EMPTY_MEMBER: FleetFavoriteMember = {
  name: '',
  description: '',
  prompt: '',
  provider: 'spawn',
}

/**
 * Status label for the provider states that are not usable. A `ready` or `one-shot`
 * row is labelled by the run types it supports instead, so no provider ever shows
 * both a run-type claim and a status for the same fact.
 */
const STATE_KEYS = {
  'not-installed': 'fleet.state.notInstalled',
  unauthenticated: 'fleet.state.unauthenticated',
  'temporarily-unavailable': 'fleet.state.unavailable',
} as const satisfies Record<Exclude<FleetProviderState, 'ready' | 'one-shot'>, TeamKey>

/**
 * Registry names whose product name Greeneek's own dictionaries carry. A provider
 * registered under any other name - an ACP adapter the deployment configured - is
 * shown by that name, because the client cannot know what its owner called it.
 */
const PROVIDER_NAME_KEYS: Readonly<Record<string, TeamKey>> = {
  fork: 'fleet.provider.fork',
  spawn: 'fleet.provider.spawn',
  'claude-code': 'fleet.provider.claudeCode',
  codex: 'fleet.provider.codex',
}

/**
 * Display name for one provider.
 * @param name - registry name, which is what a saved fleet and cordis.yml carry.
 * @param t - section dictionary.
 * @returns the product name for a provider Greeneek ships, or the registry name.
 */
function providerLabel(name: string, t: FleetSettingsSectionProps['t']): string {
  const key = PROVIDER_NAME_KEYS[name]
  return key === undefined ? name : t(key)
}

/**
 * Provider as a single line names it: the product name with the registry name
 * beside it, or the registry name alone when Greeneek ships no product name, so
 * an unbranded provider is never written twice.
 * @param name - registry name, which is what a saved fleet and cordis.yml carry.
 * @param t - section dictionary.
 * @returns the display text for one provider.
 */
function providerName(name: string, t: FleetSettingsSectionProps['t']): string {
  const label = providerLabel(name, t)
  return label === name ? name : `${label} (${name})`
}

/**
 * Run types a provider genuinely supports, in Greeneek's own names.
 *
 * Harmony is the durable continuable Agent Lane and Melody is a single delegation
 * that ends with its result; neither is a provider, and neither is an agent mode -
 * those are the presets beside the composer. The pair comes from the capability the
 * adapter implements: a session id or an ACP handshake never sets Harmony, and a
 * continuable start always also answers a single delegation, because the lane is
 * built on that same start path.
 * @param provider - one registered provider's availability row.
 * @returns the locale key naming that row's supported run types.
 */
function executionKey(provider: FleetProviderAvailability): TeamKey {
  return provider.continuable ? 'fleet.execution.both' : 'fleet.execution.melody'
}

/**
 * Label one provider row carries.
 *
 * A usable provider is distinguished by the run types it supports, because that is
 * the difference a fleet editor decision turns on; any other row states why it is
 * not usable instead, so status and run type never repeat each other.
 * @param provider - one availability row from the live registry.
 * @returns the locale key to render for that row.
 */
function rowKey(provider: FleetProviderAvailability): TeamKey {
  return provider.state === 'ready' || provider.state === 'one-shot'
    ? executionKey(provider)
    : STATE_KEYS[provider.state]
}

/** Render one caught value as a message for an inline notice. */
/**
 * One fleet mutation's outcome after both failure layers are read: the remote
 * call itself, then the business result it returns. Callers turn the message
 * into a notice and never inspect a half-read result.
 */
type FleetActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

/**
 * Read both failure layers of a host fleet mutation into one outcome.
 * @param result - the remote result carrying a fleet business result.
 * @returns the business value on success, or the message that refused it.
 */
function readFleetOutcome<T>(
  result: RemoteResult<
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >,
): FleetActionOutcome<T> {
  if (!result.ok) return { ok: false, message: result.error.message }
  return result.value.ok
    ? { ok: true, value: result.value.value }
    : { ok: false, message: result.value.error.message }
}

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

/**
 * Apply the enabled checkbox to a draft in the shape the launcher reads.
 *
 * Enabled is the default, so it is stored as the absence of the key rather than
 * `enabled: true`; simply overwriting with `true` would leave a previously stored
 * `false` in place, because spreading the draft keeps the key.
 * @param favorite - draft being edited.
 * @param enabled - checkbox state after the change.
 * @returns the draft to store.
 */
function withEnabled(favorite: FleetFavorite, enabled: boolean): FleetFavorite {
  if (!enabled) return { ...favorite, enabled: false }
  const { enabled: _dropped, ...rest } = favorite
  return rest
}

/**
 * Apply the concurrency field in the same shape, for the same reason.
 *
 * One member at a time is what the launcher does when the key is absent, so moving
 * back to 1 has to drop the key rather than keep whatever larger batch was stored.
 * @param favorite - draft being edited.
 * @param members - how many members one launch starts at once.
 * @returns the draft to store.
 */
function withConcurrency(favorite: FleetFavorite, members: number): FleetFavorite {
  if (members > 1) return { ...favorite, concurrency: members }
  const { concurrency: _dropped, ...rest } = favorite
  return rest
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
            : <option value={member.provider}>{providerName(member.provider, t)} — {t('fleet.state.notInstalled')}</option>}
          {providers.map(provider => (
            <option key={provider.name} value={provider.name} disabled={!SELECTABLE_STATES.has(provider.state)}>
              {providerName(provider.name, t)} — {t(rowKey(provider))}
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
      <label className={css.field}>
        <span>{t('fleet.timeout')}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={member.timeoutMs ?? ''}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            onChange({ timeoutMs: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined })
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
  t, subscribe, getSnapshot, loadAvailability, loadStarters, save, launch, duplicate, installStarter, canLaunch,
}: FleetSettingsSectionProps): ReactNode {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [providers, setProviders] = useState<readonly FleetProviderAvailability[]>([])
  const [starters, setStarters] = useState<readonly FleetFavorite[]>([])
  const [draft, setDraft] = useState<FleetFavorite | null>(null)
  // The id the open draft was loaded from. Editing `favorite.id` renames that row
  // rather than leaving the original behind and appending a second fleet.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingLaunch, setPendingLaunch] = useState<FleetFavorite | null>(null)
  const favorites = snapshot.value?.favorites ?? []
  const writable = snapshot.writable && snapshot.status === 'ready'

  const refreshAvailability = async (): Promise<void> => {
    const result = await loadAvailability()
    if (result.ok) setProviders(result.value)
    else setNotice(t('fleet.error', { message: result.error.message }))
  }

  // The starter catalog is read from the host so the page previews exactly what an
  // install would create, rather than a list the client would have to keep in step.
  // A composition that cannot answer is reported, and the favorites page still works.
  const refreshStarters = async (): Promise<void> => {
    try {
      const result = await loadStarters()
      if (result.ok) setStarters(result.value)
      else setNotice(t('fleet.error', { message: result.error.message }))
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    }
  }

  useEffect(() => {
    void refreshAvailability()
    void refreshStarters()
  }, [])

  /**
   * Run one host-side fleet mutation (duplicate, starter install) and report its
   * outcome in the page's own notice line, then re-read the derived rows so a refused
   * provider or a stale revision is visible instead of swallowed.
   * @param action - the mutation to attempt.
   * @param saved - locale key naming what a successful mutation did.
   */
  const runFleetAction = async (action: () => Promise<RemoteResult<FleetFavoriteResult>>, saved: TeamKey): Promise<void> => {
    setBusy(true)
    try {
      const outcome = readFleetOutcome(await action())
      if (!outcome.ok) {
        setNotice(t('fleet.error', { message: outcome.message }))
      } else {
        setNotice(t(saved))
        await refreshAvailability()
      }
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    } finally {
      setBusy(false)
    }
  }

  const openNew = (): void => {
    setDraft({ id: '', name: '', members: [{ ...EMPTY_MEMBER, provider: defaultProvider(providers) }] })
    setEditingId(null)
    setNotice(null)
  }

  const openEdit = (favorite: FleetFavorite): void => {
    setDraft(structuredClone(favorite))
    setEditingId(favorite.id)
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
      const sourceId = editingId ?? favorite.id
      const next = favorites.some(candidate => candidate.id === sourceId)
        ? favorites.map(candidate => candidate.id === sourceId ? favorite : candidate)
        : [...favorites, favorite]
      await save(next)
      setDraft(null)
      setEditingId(null)
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
      const outcome = readFleetOutcome(await launch(pendingLaunch.id))
      if (!outcome.ok) {
        setNotice(t('fleet.error', { message: outcome.message }))
      } else {
        setNotice(t('fleet.launched', { count: outcome.value.members.length }))
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
        {providers.length > 0
          ? (
            <ul className={css.providers}>
              {providers.map(provider => (
                <li key={provider.name} data-state={provider.state}>
                  <strong>{providerLabel(provider.name, t)}</strong>
                  <span>{t(rowKey(provider))}</span>
                </li>
              ))}
            </ul>
          )
          : <p className={css.status}>{t('fleet.providersEmpty')}</p>}
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
      <p className={css.description}>{t('fleet.execution.help')}</p>
      {providers.length === 0
        ? <p className={css.status}>{t('fleet.providersEmpty')}</p>
        : (
          <ul className={css.providers} aria-label={t('fleet.availability')}>
            {providers.map((provider) => {
              const label = providerLabel(provider.name, t)
              return (
                <li key={provider.name} data-state={provider.state}>
                  <div className={css.providerName}>
                    <strong>{label}</strong>
                    {/* The registry name is the value the fleet stores and cordis.yml
                        configures, so a branded row still states it. */}
                    {label === provider.name ? null : <code dir="ltr">{provider.name}</code>}
                  </div>
                  <span>{t(rowKey(provider))}</span>
                </li>
              )
            })}
          </ul>
        )}

      <div className={css.favoriteHeader}>
        <h3 className={css.subtitle}>{t('fleet.favorites')}</h3>
        <Button variant="primary" disabled={busy} onClick={openNew}>{t('fleet.new')}</Button>
      </div>
      {favorites.length === 0
        ? <p className={css.status}>{t('fleet.empty')}</p>
        : (
          <ul className={css.favorites}>
            {favorites.map((favorite) => {
              // A disabled fleet stays listed and editable but cannot be launched, and
              // the reason is stated before the click rather than after a refusal.
              const blocked = favorite.enabled === false
                ? t('fleet.disabledCannotLaunch')
                : !canLaunch() ? t('fleet.needSession') : undefined
              return (
                <li key={favorite.id} className={css.favorite}>
                  <div className={css.favoriteText}>
                    <strong>{favorite.name}</strong>
                    {favorite.enabled === false && <span className={css.tag}>{t('fleet.disabledTag')}</span>}
                    {favorite.concurrency !== undefined && favorite.concurrency > 1 && (
                      <span className={css.tag}>{t('fleet.concurrentTag', { count: favorite.concurrency })}</span>
                    )}
                    <span>{t('fleet.memberCount', { count: favorite.members.length })}</span>
                    <span className={css.memberSummary}>
                      {favorite.members.map(member => providerLabel(member.provider, t)).join(', ')}
                    </span>
                  </div>
                  <div className={css.actions}>
                    <Button variant="outline" disabled={busy} onClick={() => { openEdit(favorite) }}>{t('fleet.edit')}</Button>
                    <Button
                      variant="outline"
                      disabled={busy || blocked !== undefined}
                      title={blocked}
                      onClick={() => { setPendingLaunch(favorite) }}
                    >
                      {t('fleet.launch')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !writable}
                      onClick={() => { void runFleetAction(() => duplicate(favorite.id), 'fleet.duplicated') }}
                    >
                      {t('fleet.duplicate')}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => { void remove(favorite) }}>{t('fleet.delete')}</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

      {starters.length > 0 && (
        <section className={css.starters}>
          <h3 className={css.subtitle}>{t('fleet.starters')}</h3>
          <p className={css.description}>{t('fleet.startersHelp')}</p>
          <ul className={css.starterList}>
            {starters.map(starter => (
              <li key={starter.id} className={css.starter}>
                <div className={css.favoriteText}>
                  <strong>{starter.name}</strong>
                  <span>{t('fleet.memberCount', { count: starter.members.length })}</span>
                </div>
                <ul className={css.starterMembers}>
                  {starter.members.map(member => (
                    <li key={member.name}>{member.name} — {member.description} ({providerName(member.provider, t)})</li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  disabled={busy || !writable}
                  onClick={() => { void runFleetAction(() => installStarter(starter.id), 'fleet.installed') }}
                >
                  {t('fleet.install')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingLaunch !== null && (
        <div className={css.confirm} role="alertdialog" aria-label={t('fleet.confirmTitle')}>
          <h3>{t('fleet.confirmTitle')}</h3>
          <p>{t('fleet.confirmBody', { name: pendingLaunch.name })}</p>
          <ul>
            {pendingLaunch.members.map(member => (
              <li key={member.name}>
                {member.name}: {providerName(member.provider, t)}, {member.preset ?? t('fleet.inherited')},
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
          <label className={css.check}>
            <input
              type="checkbox"
              checked={draft.enabled !== false}
              onChange={(event) => { setDraft(withEnabled(draft, event.target.checked)) }}
            />
            <span>{t('fleet.enabled')}</span>
          </label>
          <p className={css.description}>{t('fleet.enabledHelp')}</p>
          <label className={css.field}>
            <span>{t('fleet.concurrency')}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={draft.concurrency ?? 1}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                // An unparsable field reads as the sequential default, so the stored
                // row never keeps a batch size the control no longer shows. No `max`
                // attribute: native range validation would block saving a batch that
                // is larger than a draft still short of its members.
                setDraft(withConcurrency(draft, Number.isSafeInteger(parsed) ? parsed : 1))
              }}
            />
          </label>
          {/* The practical ceiling is the member count, so a batch over it is named
              rather than left as a number that silently does something else. */}
          <p className={css.description}>
            {(draft.concurrency ?? 1) > draft.members.length
              ? t('fleet.concurrencyAllAtOnce', { count: draft.members.length })
              : t('fleet.concurrencyHelp')}
          </p>
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
                  members: [...draft.members, { ...EMPTY_MEMBER, provider: defaultProvider(providers) }],
                })
              }}
            >
              {t('fleet.addMember')}
            </Button>
            <Button variant="primary" type="submit" disabled={busy || draft.members.length === 0}>{t('fleet.save')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setEditingId(null) }}>{t('fleet.cancel')}</Button>
          </div>
        </form>
      )}

      {notice !== null && <p className={css.notice} role="status">{notice}</p>}
    </section>
  )
}
