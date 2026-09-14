/**
 * Wire-safe authorization views, free of cordis/service imports so browser
 * type chains can consume them without loading this package's Context
 * augmentation. They restate the authorization seam's vocabulary minus the
 * members a wire frame cannot carry (`AbortSignal`) and the members a browser
 * page must never receive (a raw branded `CredentialKey` travels as its
 * `scope/id` string).
 *
 * @module @greeneek/gnk-api-authorization-controller/types
 */

/** One way a flow can obtain its credential, as a method picker reads it. */
export interface AuthorizationMethodView {
  /** Flow-owned identifier, echoed back when the caller picks this method. */
  readonly id: string
  /** User-facing label. */
  readonly label: string
}

/** A running flow's report to the watching page. Never carries a secret. */
export interface AuthorizationNoticeView {
  /** What is happening, or what the human must do next. */
  readonly message: string
  /** A page the human must open to continue. */
  readonly url?: string
  /** A short code the human must enter on that page. */
  readonly code?: string
}

/** One selectable option of a `select` prompt. */
export interface AuthorizationPromptOptionView {
  /** Value returned when this option is chosen. */
  readonly id: string
  /** User-facing label. */
  readonly label: string
  /** Optional extra context rendered by capable surfaces. */
  readonly description?: string
}

/**
 * A question the flow needs answered. `secret` differs from `text` only in
 * presentation — a surface masks it and keeps the answer out of logs — and a
 * `select` answer is the chosen option's id.
 */
export type AuthorizationPromptView =
  | { readonly kind: 'text'; readonly message: string; readonly placeholder?: string }
  | { readonly kind: 'secret'; readonly message: string; readonly placeholder?: string }
  | {
    readonly kind: 'select'
    readonly message: string
    readonly options: readonly AuthorizationPromptOptionView[]
  }

/** One frame of an attempt stream, in the order a surface renders them. */
export type AuthorizationAttemptFrame =
  | { readonly kind: 'notice'; readonly notice: AuthorizationNoticeView }
  | { readonly kind: 'prompt'; readonly promptId: string; readonly prompt: AuthorizationPromptView }
  | { readonly kind: 'prompt-withdrawn'; readonly promptId: string }
  | { readonly kind: 'settled'; readonly status: AuthorizationSettlementView }

/** How an attempt ended, as the page that started it sees it. A failure ends the stream in error instead. */
export type AuthorizationSettlementView = 'authorized' | 'cancelled'

/** One registered flow as a page listing what can be signed into sees it. */
export interface AuthorizationEntryView {
  /** The credential record this flow writes, as its `scope/id` wire string. */
  readonly key: string
  /** User-facing name of what is being authorized. */
  readonly label: string
  /** The methods this flow offers, most preferred first. */
  readonly methods: readonly AuthorizationMethodView[]
  /** Whether an attempt for this key is running right now. */
  readonly inFlight: boolean
}

/** What a page answers to one prompt. A decline is the human's refusal, not a breakage. */
export type AuthorizationAnswer =
  | { readonly status: 'answered'; readonly value: string }
  | { readonly status: 'declined' }

declare module '@greeneek/gnk-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No flow claims the requested key, or it offers no such method. */
    'authorization/no-flow': { readonly key: string; readonly method?: string }
    /** An attempt for the key is already running. */
    'authorization/in-flight': { readonly key: string }
    /** The answered prompt is not, or is no longer, in flight. */
    'authorization/no-prompt': { readonly key: string; readonly promptId: string }
    /** The flow's own attempt failed; the message is the seam's. */
    'authorization/failed': { readonly key: string; readonly message: string }
  }
}
