/** Harness connections and fleet favorites inside Web Settings. */

import { useEffect, useSyncExternalStore, useState, type FormEvent, type ReactNode } from 'react'
import { GREENEEK_HARNESS, migrateFleetSettings } from '@greeneek/gnk-agent-team/client'
import type {
  FleetFavorite,
  FleetFavoriteMember,
  FleetFavoriteResult,
  FleetLaunchResult,
  FleetProviderState,
  FleetSettings,
  HarnessDescriptor,
  HarnessModel,
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
  readonly loadHarnesses: () => Promise<RemoteResult<HarnessDescriptor[]>>
  readonly refreshHarnesses: () => Promise<RemoteResult<HarnessDescriptor[]>>
  readonly refreshHarness: (connection: string) => Promise<RemoteResult<HarnessDescriptor[]>>
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

/** One Harness implementation and the named connections that mount it. */
interface HarnessGroup {
  /** Implementation identity shared by every connection of the product. */
  readonly id: string
  /** Product display name. */
  readonly displayName: string
  /** Connections in registry order. */
  readonly connections: readonly HarnessDescriptor[]
}

/**
 * Group the registry's connections under the Harness implementation each mounts.
 * @param harnesses - live descriptors from the host.
 * @returns one group per Harness, in first-registered order.
 */
function harnessGroups(harnesses: readonly HarnessDescriptor[]): HarnessGroup[] {
  const groups: HarnessGroup[] = []
  for (const descriptor of harnesses) {
    const index = groups.findIndex(candidate => candidate.id === descriptor.harness)
    const existing = groups[index]
    if (existing === undefined) {
      groups.push({
        id: descriptor.harness,
        displayName: descriptor.displayName,
        connections: [descriptor],
      })
    } else {
      groups[index] = { ...existing, connections: [...existing.connections, descriptor] }
    }
  }
  return groups
}

/**
 * Find the connection a saved member names.
 * @param harnesses - live descriptors from the host.
 * @param connection - the registry name the member stores.
 * @returns that connection's descriptor, or undefined when it is not mounted.
 */
function connectionOf(
  harnesses: readonly HarnessDescriptor[],
  connection: string,
): HarnessDescriptor | undefined {
  return harnesses.find(candidate => candidate.connection === connection)
}

/**
 * Connection a newly added member starts on, preferring one that holds a
 * durable lane.
 * @param harnesses - live descriptors from the host.
 * @returns a selectable connection name, or the Greeneek Harness connection.
 */
function defaultConnection(harnesses: readonly HarnessDescriptor[]): string {
  return harnesses.find(entry => entry.state === 'ready')?.connection
    ?? harnesses.find(entry => SELECTABLE_STATES.has(entry.state))?.connection
    ?? GREENEEK_HARNESS
}

/**
 * Execution type one connection's dispatch selects: a durable lane is Harmony,
 * a one-shot delegation is Melody, and an unusable connection names neither.
 * @param descriptor - the connection's descriptor, when mounted.
 * @returns the execution type the roster would dispatch, or undefined.
 */
function executionOf(descriptor: HarnessDescriptor | undefined): 'harmony' | 'melody' | undefined {
  if (descriptor?.state === 'ready') return 'harmony'
  if (descriptor?.state === 'one-shot') return 'melody'
  return undefined
}

/**
 * Display name for one connection: the Harness product name beside the
 * connection name, because two connections of one Harness are different.
 * @param harness - that connection's descriptor, when mounted.
 * @param connection - the registry name the member stores.
 * @param t - section dictionary.
 * @returns the display text for one connection.
 */
function connectionLabel(
  harness: HarnessDescriptor | undefined,
  connection: string,
  t: FleetSettingsSectionProps['t'],
): string {
  if (harness === undefined) return providerName(connection, t)
  if (harness.displayName === harness.connection) return harness.displayName
  // A registry name Greeneek ships a product name for leads the label, so the
  // connection reads as the Harness product rather than its command keyword.
  const productName = providerLabel(connection, t)
  return productName === connection ? `${harness.displayName} (${harness.connection})` : productName
}

/**
 * Name the way a connection's capabilities were learned, so the page never
 * presents a configured fact as live discovery.
 * @param descriptor - one connection descriptor.
 * @returns the locale key naming its discovery source.
 */
function sourceKey(descriptor: HarnessDescriptor): TeamKey {
  switch (descriptor.source) {
    case 'registration': return 'fleet.source.registration'
    case 'configuration': return 'fleet.source.configuration'
    case 'acp-initialize': return 'fleet.source.initialize'
    case 'acp-session': return 'fleet.source.session'
  }
}

/**
 * Label one connection row carries: the run types it supports when usable, or
 * the reason it is not.
 * @param descriptor - one connection descriptor.
 * @returns the locale key to render for that row.
 */
function connectionStateKey(descriptor: HarnessDescriptor): TeamKey {
  switch (descriptor.state) {
    case 'ready': return 'fleet.execution.both'
    case 'one-shot': return 'fleet.execution.melody'
    case 'not-installed': return 'fleet.state.notInstalled'
    case 'unauthenticated': return 'fleet.state.unauthenticated'
    case 'temporarily-unavailable': return 'fleet.state.unavailable'
  }
}

/**
 * Models a connection advertises as options for one member field.
 * @param descriptor - one connection descriptor.
 * @returns the advertised catalog, or undefined when it is unknown.
 */
function advertisedModels(descriptor: HarnessDescriptor | undefined): readonly HarnessModel[] | undefined {
  return descriptor === undefined || descriptor.models === 'unknown' ? undefined : descriptor.models
}

/**
 * Effort levels one advertised model accepts.
 * @param model - the selected model, when the connection advertises a catalog.
 * @returns the model's levels, or undefined when it advertises none.
 */
function advertisedEfforts(model: HarnessModel | undefined): readonly { id: string; name?: string }[] | undefined {
  const efforts = model?.efforts
  return efforts === undefined || efforts.length === 0 ? undefined : efforts
}

const EMPTY_MEMBER: FleetFavoriteMember = {
  name: '',
  description: '',
  prompt: '',
  provider: GREENEEK_HARNESS,
}

/**
 * Registry names whose product name Greeneek's own dictionaries carry. A provider
 * registered under any other name - an ACP adapter the deployment configured - is
 * shown by that name, because the client cannot know what its owner called it.
 */
const PROVIDER_NAME_KEYS: Readonly<Record<string, TeamKey>> = {
  [GREENEEK_HARNESS]: 'fleet.provider.greeneek',
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
 * Provider as a single line names it: the product name alone when the registry
 * name is that product's own identity, the product name with the registry name
 * beside it for a branded external connection, or the registry name alone when
 * Greeneek ships no product name, so an unbranded provider is never written twice.
 * @param name - registry name, which is what a saved fleet and cordis.yml carry.
 * @param t - section dictionary.
 * @returns the display text for one provider.
 */
function providerName(name: string, t: FleetSettingsSectionProps['t']): string {
  const label = providerLabel(name, t)
  if (label === name) return name
  return label.toLocaleLowerCase() === name ? label : `${label} (${name})`
}

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

/**
 * Render one caught value as a message for an inline notice.
 * @param error - the caught value.
 * @returns its message, or its string form when it is not an Error.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Narrow one settings section to the fleet shape, migrating stored members
 * that name internal Greeneek strategies to the Harness connection so the page
 * edits and writes back the current vocabulary. */
export function decodeFleetSettings(section: unknown): FleetSettings | undefined {
  if (typeof section !== 'object' || section === null || !('favorites' in section)) return undefined
  const favorites = (section as { readonly favorites?: unknown }).favorites
  return Array.isArray(favorites) ? migrateFleetSettings(section as FleetSettings) : undefined
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

/**
 * Facts a connection advertises about itself, in one compact line. Every
 * descriptor states its model catalog, so the line is never empty.
 * @param descriptor - one connection descriptor.
 * @param t - section dictionary.
 * @returns the advertising facts the descriptor carries.
 */
function capabilityText(
  descriptor: HarnessDescriptor,
  t: FleetSettingsSectionProps['t'],
): string {
  const facts: string[] = []
  if (descriptor.models === 'unknown') facts.push(t('fleet.capability.modelsUnknown'))
  else facts.push(t('fleet.capability.models', { count: descriptor.models.length }))
  if (descriptor.sessions !== undefined) {
    const parts = [
      descriptor.sessions.load ? 'load' : undefined,
      descriptor.sessions.resume ? 'resume' : undefined,
      descriptor.sessions.fork ? t('fleet.capability.sessionFork') : undefined,
      descriptor.sessions.list ? 'list' : undefined,
      descriptor.sessions.delete ? 'delete' : undefined,
    ].filter((part): part is string => part !== undefined)
    if (parts.length > 0) facts.push(`${t('fleet.capability.sessions')}: ${parts.join(', ')}`)
  }
  if (descriptor.prompt !== undefined) {
    const parts = [
      descriptor.prompt.image ? 'image' : undefined,
      descriptor.prompt.audio ? 'audio' : undefined,
      descriptor.prompt.embeddedContext ? 'embeddedContext' : undefined,
    ].filter((part): part is string => part !== undefined)
    if (parts.length > 0) facts.push(`${t('fleet.capability.prompt')}: ${parts.join(', ')}`)
  }
  if (descriptor.permissions !== undefined && descriptor.permissions.length > 0) {
    facts.push(`${t('fleet.capability.permissions')}: ${descriptor.permissions.map(mode => mode.id).join(', ')}`)
  }
  if (descriptor.authMethods !== undefined && descriptor.authMethods.length > 0) {
    facts.push(`${t('fleet.capability.auth')}: ${descriptor.authMethods.map(method => method.name ?? method.id).join(', ')}`)
  }
  return facts.join(' · ')
}

/**
 * Harness connections the host knows, grouped by the Harness implementation each
 * mounts. A row states how its facts were learned and, when a probe failed, what
 * the failure was — registration facts are never dressed up as live discovery.
 */
function HarnessInventory({ harnesses, busy, t, onProbe }: {
  readonly harnesses: readonly HarnessDescriptor[]
  readonly busy: boolean
  readonly t: FleetSettingsSectionProps['t']
  readonly onProbe: (connection: string) => void
}): ReactNode {
  return (
    <div className={css.harnessGroups}>
      {harnessGroups(harnesses).map(group => (
        <section key={group.id} className={css.harnessGroup}>
          <h4 className={css.harnessName}>{group.displayName}</h4>
          <ul className={css.providers} aria-label={group.displayName}>
            {group.connections.map((connection) => {
              const capability = capabilityText(connection, t)
              return (
                <li key={connection.connection} data-state={connection.state}>
                  <div className={css.providerName}>
                    <strong>{connectionLabel(connection, connection.connection, t)}</strong>
                    {/* The connection name is the value the fleet stores and
                        cordis.yml configures, so a branded row still states it. */}
                    {connection.displayName === connection.connection
                      ? null
                      : <code dir="ltr">{connection.connection}</code>}
                  </div>
                  <span>{t(connectionStateKey(connection))}</span>
                  <span className={css.tag}>{t(sourceKey(connection))}</span>
                  {connection.discoveredAt === undefined
                    ? null
                    : (
                      <span className={css.tag}>
                        {t('fleet.discoveredAt', {
                          time: new Date(connection.discoveredAt).toLocaleString(),
                        })}
                      </span>
                    )}
                  <p className={css.description}>{capability}</p>
                  {connection.discoveryError === undefined
                    ? null
                    : (
                      <p className={css.notice} role="status">
                        {t('fleet.discoveryError', { message: connection.discoveryError })}
                      </p>
                    )}
                  {connection.canProbe
                    ? (
                      <Button variant="outline" disabled={busy} onClick={() => { onProbe(connection.connection) }}>
                        {t('fleet.discover')}
                      </Button>
                    )
                    : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** One member field editor. */
function MemberEditor({ index, member, harnesses, t, onChange, onRemove }: {
  readonly index: number
  readonly member: FleetFavoriteMember
  readonly harnesses: readonly HarnessDescriptor[]
  readonly t: FleetSettingsSectionProps['t']
  readonly onChange: (patch: MemberPatch) => void
  readonly onRemove: () => void
}): ReactNode {
  const scopes = member.writeScopes?.join(', ') ?? ''
  const groups = harnessGroups(harnesses)
  const connection = connectionOf(harnesses, member.provider)
  const harnessId = connection?.harness ?? member.provider
  const connections = groups.find(group => group.id === harnessId)?.connections ?? []
  const models = advertisedModels(connection)
  const selectedModel = models?.find(model => model.id === member.model)
  const efforts = advertisedEfforts(selectedModel)
  const capability = connection === undefined ? undefined : capabilityText(connection, t)

  /**
   * Move the member to one Harness, keeping only settings the new connection can honor.
   * @param id - the Harness implementation identity.
   */
  const selectHarness = (id: string): void => {
    const next = groups.find(group => group.id === id)?.connections
      .find(candidate => SELECTABLE_STATES.has(candidate.state))
    if (next === undefined) return
    onChange({
      provider: next.connection,
      model: undefined,
      reasoningEffort: undefined,
      context: next.contextStrategies[0],
      execution: executionOf(next),
    })
  }

  /**
   * Move the member to one connection of the current Harness.
   * @param name - the connection's registry name.
   */
  const selectConnection = (name: string): void => {
    const next = connectionOf(harnesses, name)
    onChange({
      provider: name,
      model: undefined,
      reasoningEffort: undefined,
      context: member.context !== undefined && next?.contextStrategies.includes(member.context) === true
        ? member.context
        : next?.contextStrategies[0],
      execution: executionOf(next),
    })
  }

  const execution = member.execution ?? executionOf(connection)

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
        <span>{t('fleet.harness')}</span>
        <select
          value={harnessId}
          onChange={(event) => { selectHarness(event.target.value) }}
        >
          {groups.some(group => group.id === harnessId)
            ? null
            : <option value={harnessId}>{providerName(harnessId, t)} — {t('fleet.state.notInstalled')}</option>}
          {groups.map(group => (
            <option
              key={group.id}
              value={group.id}
              disabled={!group.connections.some(candidate => SELECTABLE_STATES.has(candidate.state))}
            >
              {group.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span>{t('fleet.connection')}</span>
        <select
          value={member.provider}
          onChange={(event) => { selectConnection(event.target.value) }}
        >
          {connections.some(candidate => candidate.connection === member.provider)
            ? null
            : (
              <option value={member.provider}>
                {connectionLabel(connection, member.provider, t)} — {t('fleet.state.notInstalled')}
              </option>
            )}
          {connections.map(candidate => (
            <option
              key={candidate.connection}
              value={candidate.connection}
              disabled={!SELECTABLE_STATES.has(candidate.state)}
            >
              {connectionLabel(candidate, candidate.connection, t)} — {t(connectionStateKey(candidate))}
            </option>
          ))}
        </select>
      </label>
      {capability === undefined ? null : <p className={css.description}>{capability}</p>}
      {execution !== undefined && (
        <p className={css.description}>
          {t('fleet.executionType')}: {t(execution === 'harmony' ? 'fleet.execution.harmony' : 'fleet.execution.melodyName')}
          {' — '}{t(execution === 'harmony' ? 'fleet.execution.harmonyDetail' : 'fleet.execution.melodyDetail')}
        </p>
      )}
      <label className={css.field}>
        <span>{t('fleet.context')}</span>
        <select
          value={member.context ?? 'fresh'}
          onChange={(event) => { onChange({ context: event.target.value as 'fresh' | 'fork' }) }}
        >
          <option value="fresh" disabled={connection !== undefined && !connection.contextStrategies.includes('fresh')}>
            {t('fleet.context.fresh')}
          </option>
          <option value="fork" disabled={connection?.supportsContextFork !== true}>{t('fleet.context.fork')}</option>
        </select>
      </label>
      {connection !== undefined && !connection.supportsContextFork
        ? <p className={css.description}>{t('fleet.contextForkUnavailable')}</p>
        : null}
      <label className={css.field}>
        <span>{t('fleet.preset')}</span>
        <input
          value={member.preset ?? ''}
          onChange={(event) => { onChange({ preset: event.target.value || undefined }) }}
        />
      </label>
      <label className={css.field}>
        <span>{t('fleet.model')}</span>
        {models === undefined
          ? (
            <input
              value={member.model ?? ''}
              placeholder={t('fleet.inherited')}
              onChange={(event) => { onChange({ model: event.target.value || undefined }) }}
            />
          )
          : (
            <select
              value={member.model ?? ''}
              onChange={(event) => { onChange({ model: event.target.value || undefined, reasoningEffort: undefined }) }}
            >
              <option value="">{t('fleet.harnessDefault')}</option>
              {models.some(model => model.id === member.model)
                ? null
                : <option value={member.model ?? ''}>{member.model} — {t('fleet.modelNotAdvertised')}</option>}
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name === undefined || model.name === model.id ? model.id : `${model.name} (${model.id})`}
                </option>
              ))}
            </select>
          )}
      </label>
      <label className={css.field}>
        <span>{t('fleet.effort')}</span>
        {efforts === undefined
          ? (
            <input
              value={member.reasoningEffort ?? ''}
              placeholder={t('fleet.inherited')}
              onChange={(event) => { onChange({ reasoningEffort: event.target.value || undefined }) }}
            />
          )
          : (
            <select
              value={member.reasoningEffort ?? ''}
              onChange={(event) => { onChange({ reasoningEffort: event.target.value || undefined }) }}
            >
              <option value="">{t('fleet.harnessDefault')}</option>
              {efforts.some(level => level.id === member.reasoningEffort)
                ? null
                : (
                  <option value={member.reasoningEffort ?? ''}>
                    {member.reasoningEffort} — {t('fleet.effortNotAdvertised')}
                  </option>
                )}
              {efforts.map(level => (
                <option key={level.id} value={level.id}>
                  {level.name === undefined || level.name === level.id ? level.id : `${level.name} (${level.id})`}
                </option>
              ))}
            </select>
          )}
      </label>
      {models === undefined || efforts !== undefined
        ? null
        : <p className={css.description}>{t('fleet.effortHelp')}</p>}
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
 * Render Harness connections and the named favorite editor.
 * @param props - settings section runtime, localized copy, and injected fleet actions.
 * @returns the fleet settings page.
 */
export function FleetSettingsSection({
  t, subscribe, getSnapshot, loadHarnesses, refreshHarnesses, refreshHarness, loadStarters, save, launch, duplicate,
  installStarter, canLaunch,
}: FleetSettingsSectionProps): ReactNode {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [harnesses, setHarnesses] = useState<readonly HarnessDescriptor[]>([])
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

  /**
   * Read the connections the host already knows. This never probes, so opening
   * Settings cannot start ten subprocesses; discovery is a user gesture.
   */
  const loadInventory = async (): Promise<void> => {
    try {
      const result = await loadHarnesses()
      if (result.ok) setHarnesses(result.value)
      else setNotice(t('fleet.error', { message: result.error.message }))
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    }
  }

  /**
   * Probe connections and publish what each one answered.
   * @param connection - one connection to re-probe, or omitted to probe every probeable connection.
   */
  const probeInventory = async (connection?: string): Promise<void> => {
    setBusy(true)
    try {
      const result = connection === undefined ? await refreshHarnesses() : await refreshHarness(connection)
      if (result.ok) setHarnesses(result.value)
      else setNotice(t('fleet.error', { message: result.error.message }))
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    } finally {
      setBusy(false)
    }
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
    void loadInventory()
    void refreshStarters()
  }, [])

  /**
   * Run one host-side fleet mutation (duplicate, starter install) and report its
   * outcome in the page's own notice line, then re-read the derived rows so a refused
   * connection or a stale revision is visible instead of swallowed.
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
        await loadInventory()
      }
    } catch (error: unknown) {
      setNotice(t('fleet.error', { message: errorText(error) }))
    } finally {
      setBusy(false)
    }
  }

  const openNew = (): void => {
    setDraft({ id: '', name: '', members: [{ ...EMPTY_MEMBER, provider: defaultConnection(harnesses) }] })
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
      // Every saved member states its execution type, derived from the live
      // connection when the draft predates the field, so a later launch can
      // refuse a semantic drift instead of silently changing how it runs.
      members: draft.members.map((member) => {
        const execution = member.execution ?? executionOf(connectionOf(harnesses, member.provider))
        return execution === undefined ? member : { ...member, execution }
      }),
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
      await loadInventory()
    }
  }

  if (snapshot.status === 'loading') return <p className={css.status}>{t('fleet.loading')}</p>
  if (snapshot.status === 'unavailable' || !writable) {
    return (
      <section className={css.root}>
        <h2 className={css.title}>{t('fleet.title')}</h2>
        <p className={css.status}>{t('fleet.unavailable')}</p>
        <Button variant="outline" disabled={busy} onClick={() => { void probeInventory() }}>{t('fleet.refreshHarnesses')}</Button>
        {harnesses.length > 0
          ? <HarnessInventory harnesses={harnesses} busy={busy} t={t} onProbe={(connection) => { void probeInventory(connection) }} />
          : <p className={css.status}>{t('fleet.harnessesEmpty')}</p>}
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
        <Button variant="outline" disabled={busy} onClick={() => { void probeInventory() }}>{t('fleet.refreshHarnesses')}</Button>
      </header>

      <h3 className={css.subtitle}>{t('fleet.availability')}</h3>
      <p className={css.description}>{t('fleet.execution.help')}</p>
      {harnesses.length === 0
        ? <p className={css.status}>{t('fleet.harnessesEmpty')}</p>
        : <HarnessInventory harnesses={harnesses} busy={busy} t={t} onProbe={(connection) => { void probeInventory(connection) }} />}

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
                      {favorite.members.map((member) => {
                        const descriptor = connectionOf(harnesses, member.provider)
                        const label = connectionLabel(descriptor, member.provider, t)
                        const execution = member.execution ?? executionOf(descriptor)
                        return execution === undefined
                          ? label
                          : `${label} (${t(execution === 'harmony' ? 'fleet.execution.harmony' : 'fleet.execution.melodyName')})`
                      }).join(', ')}
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
                  {starter.members.map((member) => {
                    const descriptor = connectionOf(harnesses, member.provider)
                    const execution = member.execution ?? executionOf(descriptor)
                    return (
                      <li key={member.name}>
                        {member.name} — {member.description} ({connectionLabel(descriptor, member.provider, t)}
                        {execution === undefined
                          ? null
                          : `, ${t(execution === 'harmony' ? 'fleet.execution.harmony' : 'fleet.execution.melodyName')}`})
                      </li>
                    )
                  })}
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
            {pendingLaunch.members.map((member) => {
              const descriptor = connectionOf(harnesses, member.provider)
              const execution = member.execution ?? executionOf(descriptor)
              return (
                <li key={member.name}>
                  {member.name}: {connectionLabel(descriptor, member.provider, t)},
                  {execution === undefined
                    ? null
                    : ` ${t(execution === 'harmony' ? 'fleet.execution.harmony' : 'fleet.execution.melodyName')},`}
                  {' '}{member.preset ?? t('fleet.inherited')},
                  {' '}{member.model ?? t('fleet.inherited')},
                  {' '}{member.reasoningEffort ?? t('fleet.inherited')},
                  {' '}{member.maxTokens === undefined ? t('fleet.unbounded') : t('fleet.tokens', { count: member.maxTokens })},
                  {' '}{member.readOnly === true
                    ? t('fleet.readOnly')
                    : member.writeScopes === undefined || member.writeScopes.length === 0
                      ? t('fleet.sharedCheckout')
                      : t('fleet.scopes', { scopes: member.writeScopes.join(', ') })}
                </li>
              )
            })}
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
              harnesses={harnesses}
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
                  members: [...draft.members, { ...EMPTY_MEMBER, provider: defaultConnection(harnesses) }],
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
