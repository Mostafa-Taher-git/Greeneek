/**
 * The web-search card's staged form over the `web-search-greeneek` settings
 * namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the card shows.
 */

import type { Context as ClientContext } from '@greeneek/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@greeneek/gnk-api-remotes/client'
import type { SnapshotStore } from '@greeneek/gnk-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@greeneek/gnk-client-ui-settings/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the Greeneek search provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_NS = 'web-search-greeneek'

/**
 * Namespace owning the search-provider pin. The engine row writes the same
 * field, so both surfaces stay in sync with no further coordination.
 */
export const ENGINE_SETTINGS_NAMESPACE = 'web'

/** Field carrying the pinned search provider id; absence means auto-select. */
export const ENGINE_PROVIDER_FIELD = 'searchProvider'

/** Empty provider id: no pin, the service auto-selects the usable provider. */
export const PROVIDER_AUTO = ''

/** Provider id of the DuckDuckGo search backend (keyless: works with no key). */
export const PROVIDER_DUCKDUCKGO = 'duckduckgo'

/** Provider id of the Google search backend (key from the launch environment). */
export const PROVIDER_GOOGLE = 'google'

/** Provider id of the Exa search backend (key from the launch environment). */
export const PROVIDER_EXA = 'exa'

/** Provider id of the Perplexity search backend (key from the launch environment). */
export const PROVIDER_PERPLEXITY = 'perplexity'

/**
 * Provider id of the Greeneek search backend, offered in the card as Custom:
 * it accepts any Anthropic-compatible Messages endpoint, so it is the
 * vehicle for a user-supplied search provider.
 */
export const PROVIDER_CUSTOM = 'greeneek-official'

/** Every provider id the card offers, in display order. */
export const PROVIDER_IDS = [
  PROVIDER_AUTO,
  PROVIDER_DUCKDUCKGO,
  PROVIDER_GOOGLE,
  PROVIDER_EXA,
  PROVIDER_PERPLEXITY,
  PROVIDER_CUSTOM,
] as const

/** Provider id the card offers. */
export type SearchProviderId = typeof PROVIDER_IDS[number]

/** True for a provider id the card offers (anything else fails loud on write). */
export function isOfferedSearchProvider(id: string): id is SearchProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id)
}

/** The engine-pin section: only the provider choice lives here. */
export interface EnginePinSettings {
  /** Pinned search provider id; absence means auto-select. */
  searchProvider?: string
}

/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'GREENEEK_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The search-provider fields this card edits. */
export interface WebSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Provider model; blank inherits the provider default. */
  model?: string
  /** Maximum searches served within one request. */
  maxUses?: number
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the web-search card renders. */
export interface WebSearchCardState extends CardShell {
  /** Active provider id; '' means auto-select. */
  provider: string
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Provider model. */
  model: CardFieldState
  /** Searches allowed per request. */
  maxUses: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the web-search card's slot entry injects. */
export interface WebSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
  /** Pin one offered provider id ('' returns to auto-select); unknown ids throw. */
  setProvider: (id: string) => void
}

/** Bridges the `web-search-greeneek` scope and the credentials domain onto the card. */
export class WebSearchCardController {
  private readonly form: CardForm<WebSearchSettings>
  private readonly store: SnapshotStore<WebSearchCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-greeneek` namespace.
   * @param engineScope - the bound settings scope for the `web` namespace's provider pin.
   * @param ctx - the card plugin's context, whose `remote.credentials` namespace
   * answers for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<WebSearchSettings>,
    private readonly engineScope: SettingsScope<EnginePinSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), textField('model'), numberField('maxUses')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    engineScope.subscribe(() => { this.store.set(this.projection()) })
    void this.readCredential()
  }

  private projection(): WebSearchCardState {
    return {
      ...this.form.shell(),
      provider: this.engineScope.getSnapshot().value?.searchProvider ?? '',
      baseURL: this.form.field('baseURL'),
      model: this.form.field('model'),
      maxUses: this.form.field('maxUses'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    return { hooks: { webSearchCard: this.store }, setProvider: (id) => { this.setProvider(id) }, ...this.form.actions() }
  }

  /**
   * Pin the search provider this card offers. Writes the same `web` field
   * the engine row writes, so both surfaces stay in sync.
   * @param id - one offered provider id; '' returns to auto-select.
   */
  private setProvider(id: string): void {
    if (!isOfferedSearchProvider(id)) throw new Error(`search provider "${id}" is not offered`)
    if (id === PROVIDER_AUTO) {
      void this.engineScope.unset(ENGINE_PROVIDER_FIELD)
      return
    }
    void this.engineScope.set(ENGINE_PROVIDER_FIELD, id)
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<WebSearchSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
