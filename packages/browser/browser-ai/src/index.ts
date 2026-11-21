/**
 * Browser AI connections (`ctx.browserAI`): a registry of official web AI
 * providers with independent manual and automation capabilities, and one
 * isolated persistent browser session per provider. Greeneek never collects a
 * password and never extracts an authentication cookie or token into its own
 * state. Automation is refused by name wherever the provider's capability
 * matrix marks it unavailable.
 * @module @greeneek/gnk-browser-ai
 */
import { Context, Service } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import { BrowserAIError } from './error.ts'
import type { BrowserPageContent, BrowserProviderProfile } from '@greeneek/gnk-browser-use'
import type {} from '@greeneek/gnk-browser-use'
import type {
  BrowserAIErrorCode, BrowserAIProvider, BrowserAISession, BrowserAISessionStatus,
} from './types.ts'

export { BrowserAIError } from './error.ts'
export type {
  BrowserAIErrorCode, BrowserAIVendor, BrowserAIProvider,
  BrowserAISession, BrowserAISessionStatus,
} from './types.ts'

declare module '@greeneek/cordis' {
  interface Context {
    /** Browser AI connection registry and session manager. */
    browserAI: BrowserAIRegistry
  }
}

/** Built-in provider capability matrix, recorded with the compliance research. */
export const BUILTIN_PROVIDERS: readonly BrowserAIProvider[] = [
  {
    id: 'chatgpt',
    vendor: 'openai',
    labelKey: 'browserAI.provider.chatgpt',
    officialUrl: 'https://chatgpt.com/',
    manual: true,
    automation: false,
    automationReason: 'ChatGPT web terms and UI protections do not support reliable third-party automation of a subscription session; use Manual Mode or the Codex AgentProvider.',
    termsSource: 'Phase 9 Browser AI Accounts, compliance finding for OpenAI (2026-11-03)',
  },
  {
    id: 'claude',
    vendor: 'anthropic',
    labelKey: 'browserAI.provider.claude',
    officialUrl: 'https://claude.ai/',
    manual: true,
    automation: false,
    automationReason: 'Anthropic terms do not permit third-party automation of a Claude.ai subscription session; use Manual Mode or the Claude Code AgentProvider.',
    termsSource: 'Phase 9 Browser AI Accounts, compliance finding for Anthropic (2026-11-03)',
  },
  {
    id: 'gemini',
    vendor: 'google',
    labelKey: 'browserAI.provider.gemini',
    officialUrl: 'https://gemini.google.com/',
    manual: true,
    automation: false,
    automationReason: 'Google prohibits third-party automation of product OAuth sessions; use Manual Mode or the API-key model path.',
    termsSource: 'Phase 9 Browser AI Accounts, compliance finding for Google (2026-11-03)',
  },
]

/** One session record: status only, never credential material. */
interface SessionRecord {
  status: BrowserAISessionStatus
}

/** The Browser AI registry and isolated session manager. */
export class BrowserAIRegistry extends Service {
  /** The browser-use seam this manager drives for isolated sessions. */
  static inject = ['browser']

  private readonly providers = new Map<string, BrowserAIProvider>()
  private readonly sessions = new Map<string, SessionRecord>()
  private disposedFlag = false

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'browserAI')
    for (const provider of BUILTIN_PROVIDERS) this.providers.set(provider.id, provider)
    ctx.effect(() => () => {
      this.disposedFlag = true
      this.sessions.clear()
    }, 'browser-ai teardown')
  }

  /**
   * All registered providers, for a connection list UI.
   * @returns the immutable provider roster.
   */
  list(): readonly BrowserAIProvider[] {
    return [...this.providers.values()]
  }

  /**
   * Resolve one provider or fail with a stable code.
   * @param providerId - provider to resolve.
   * @returns the provider descriptor.
   */
  get(providerId: string): BrowserAIProvider {
    const provider = this.providers.get(providerId)
    if (provider === undefined) {
      throw this.error('PROVIDER_NOT_FOUND', `unknown browser AI provider ${providerId}`)
    }
    return provider
  }

  /**
   * The isolated browser profile for one provider.
   * @param providerId - provider whose profile to resolve.
   * @returns the provider-isolated profile id.
   */
  profile(providerId: string): BrowserProviderProfile {
    this.get(providerId)
    return `provider:${providerId}`
  }

  /**
   * Status of one provider session (login-required before first open).
   * @param providerId - provider whose status to report.
   * @returns the credential-free session projection.
   */
  status(providerId: string): BrowserAISession {
    return this.project(providerId)
  }

  /**
   * Open a provider's official site in its isolated browser profile for manual
   * use. The browser surface becomes visible through the browser/surface event.
   * @param providerId - provider to open.
   * @returns the session snapshot after opening.
   */
  async openManual(providerId: string): Promise<BrowserAISession> {
    const provider = this.get(providerId)
    this.assertActive()
    if (!provider.manual) {
      throw this.error('MANUAL_UNAVAILABLE', `provider ${providerId} does not support manual browser sessions`)
    }
    const profile = this.profile(providerId)
    await this.ctx.browser.open(undefined, { profile, url: provider.officialUrl })
    this.sessions.set(providerId, { status: 'connected' })
    return this.project(providerId)
  }

  /**
   * Read the visible page of a provider session with the untrusted-content
   * boundary applied by the browser tool layer. Never returns cookies/tokens.
   * @param providerId - provider whose session to read.
   * @returns the bounded page content.
   */
  async read(providerId: string): Promise<BrowserPageContent> {
    const provider = this.get(providerId)
    this.assertActive()
    if (!provider.manual) {
      throw this.error('MANUAL_UNAVAILABLE', `provider ${providerId} has no manual browser session`)
    }
    return this.ctx.browser.read(undefined, { profile: this.profile(providerId) })
  }

  /**
   * Authorized automation entry point. Refused by name for every provider whose
   * capability matrix marks automation unavailable - never approximated.
   * @param providerId - provider the caller wants to automate.
   * @param agent - exact owning Agent (kept for the future authorized path).
   * @returns never; every path throws with a stable refusal code.
   */
  automate(providerId: string, agent: Agent | undefined): never {
    this.assertActive()
    const provider = this.get(providerId)
    void agent
    if (!provider.automation) {
      throw this.error(
        'AUTOMATION_UNAVAILABLE',
        `automation for ${providerId} is not supported: ${provider.automationReason ?? 'not declared'}`,
      )
    }
    throw this.error('AUTOMATION_UNAVAILABLE', `automation for ${providerId} is not enabled in this build`)
  }

  /**
   * Mark a session as login-required or expired (user/UI action).
   * @param providerId - provider whose session changed.
   * @param status - new lifecycle status.
   * @returns the updated session projection.
   */
  setStatus(providerId: string, status: BrowserAISessionStatus): BrowserAISession {
    this.get(providerId)
    this.sessions.set(providerId, { status })
    return this.project(providerId)
  }

  /**
   * Clear a provider session's status; browser profile storage is untouched here.
   * @param providerId - provider whose session status to clear.
   * @returns the reset session projection.
   */
  clear(providerId: string): BrowserAISession {
    this.get(providerId)
    this.sessions.delete(providerId)
    return this.project(providerId)
  }

  /** Project one provider's status without leaking credential material. */
  private project(providerId: string): BrowserAISession {
    const provider = this.get(providerId)
    const status = this.sessions.get(providerId)?.status ?? 'login-required'
    return {
      providerId,
      profile: this.profile(providerId),
      url: provider.officialUrl,
      status,
      capabilities: {
        manual: provider.manual,
        automation: provider.automation,
        automationReason: provider.automationReason,
      },
    }
  }

  private assertActive(): void {
    if (this.disposedFlag) throw this.error('SERVICE_DISPOSING', 'browser AI registry is disposing')
  }

  private error(code: BrowserAIErrorCode, message: string): BrowserAIError {
    return new BrowserAIError(code, message)
  }
}

export default BrowserAIRegistry
