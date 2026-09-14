/**
 * Host owner of the `authorization` Remote namespace: the authorization seam
 * as a browser sign-in page drives it.
 *
 * One attempt is one Remote **stream**: the page opens `attempt()` and reads
 * frames — notices, prompts, withdrawn prompts, and the final settlement —
 * while the flow runs on the Host. A prompt is answered through `answer()`
 * under the prompt id the frame carried, and cancelling is closing the stream:
 * the carrier's abort reaches the flow through the request signal. Stream
 * frames instead of forwarded events because an authorization prompt is
 * host-global — it names no Agent — and a forwarded waterfall requires an
 * Agent identity to route to a page.
 *
 * @module @greeneek/gnk-api-authorization-controller/authorization
 */

import { Context } from '@greeneek/cordis'
import AuthorizationService, {
  AuthorizationDeclinedError, AuthorizationError,
  type AuthorizationEntry, type AuthorizationNotice, type AuthorizationPrompt,
} from '@greeneek/gnk-authorization'
import { credentialKey, isCredentialKeySegment } from '@greeneek/gnk-credentials'
import type { CredentialKey } from '@greeneek/gnk-credentials/types'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import type {
  AuthorizationAnswer, AuthorizationAttemptFrame, AuthorizationEntryView,
  AuthorizationNoticeView, AuthorizationPromptOptionView, AuthorizationPromptView,
} from './types.ts'

/** One prompt waiting for its page's answer, with the handles to settle it. */
interface PromptSlot {
  /** Settles the flow's prompt with the typed or chosen value. */
  readonly resolve: (value: string) => void
  /** Fails the flow's prompt: a decline reads as refusal, a breakage as failure. */
  readonly reject: (error: unknown) => void
  /** What the flow asked, restated for the frame that carried it. */
  readonly view: AuthorizationPromptView
}

/** Per-key bookkeeping for the prompts one page is answering. */
export class AttemptRegistry {
  private readonly attempts = new Map<string, Map<string, PromptSlot>>()
  private counter = 0

  /**
   * Register one prompt under its attempt.
   * @param key - the attempt's wire key.
   * @param slot - the prompt's settle handles and rendered view.
   * @returns the prompt id the frame named.
   */
  register(key: string, slot: PromptSlot): string {
    let prompts = this.attempts.get(key)
    if (prompts === undefined) {
      prompts = new Map()
      this.attempts.set(key, prompts)
    }
    const promptId = `p${++this.counter}`
    prompts.set(promptId, slot)
    return promptId
  }

  /**
   * Settle one prompt from a page's answer.
   * @param key - the attempt's wire key.
   * @param promptId - the id the prompt frame carried.
   * @param answer - the page's answer, typed value or decline.
   * @throws RemoteError code `authorization/no-prompt` for an id that is not, or is
   *   no longer, in flight.
   */
  answer(key: string, promptId: string, answer: AuthorizationAnswer): void {
    const slot = this.attempts.get(key)?.get(promptId)
    if (slot === undefined) {
      throw new RemoteError('authorization/no-prompt', `no prompt \"${promptId}\" is in flight for \"${key}\"`, { key, promptId })
    }
    this.withdraw(key, promptId)
    if (answer.status === 'declined') {
      slot.reject(new AuthorizationDeclinedError())
      return
    }
    slot.resolve(answer.value)
  }

  /**
   * Withdraw one prompt: a flow retiring the losing side of a race, or its
   * attempt ending beneath an open question.
   * @param key - the attempt's wire key.
   * @param promptId - the id the prompt frame carried.
   */
  withdraw(key: string, promptId: string): void {
    this.attempts.get(key)?.delete(promptId)
  }

  /** Drop every prompt of one attempt. */
  dropAll(key: string): void {
    this.attempts.delete(key)
  }
}

/**
 * Render one seam prompt in the frame vocabulary, dropping the `AbortSignal` a
 * wire frame cannot carry.
 * @param prompt - what the flow asked.
 * @returns the prompt view.
 */
function promptView(prompt: AuthorizationPrompt): AuthorizationPromptView {
  const optional = (placeholder: string | undefined): { placeholder?: string } =>
    placeholder === undefined ? {} : { placeholder }
  switch (prompt.kind) {
    case 'select':
      return {
        kind: 'select',
        message: prompt.message,
        options: prompt.options.map((option: AuthorizationPromptOptionView) =>
          option.description === undefined ? { id: option.id, label: option.label } : option),
      }
    case 'secret':
      return { kind: 'secret', message: prompt.message, ...optional(prompt.placeholder) }
    default:
      return { kind: 'text', message: prompt.message, ...optional(prompt.placeholder) }
  }
}

/**
 * Render one seam notice, dropping absent members so the frame carries only
 * what the surface renders.
 * @param notice - what the flow reported.
 * @returns the notice view.
 */
function noticeView(notice: AuthorizationNotice): AuthorizationNoticeView {
  return {
    message: notice.message,
    ...notice.url === undefined ? {} : { url: notice.url },
    ...notice.code === undefined ? {} : { code: notice.code },
  }
}

/**
 * Project one registered flow into the page's vocabulary.
 * @param entry - the seam's entry.
 * @returns the wire view, with the key as its `scope/id` string.
 */
export function projectEntry(entry: AuthorizationEntry): AuthorizationEntryView {
  return {
    key: String(entry.key),
    label: entry.label,
    methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
    inFlight: entry.inFlight,
  }
}

/**
 * Classify one attempt failure for the page that opened the stream. The seam's
 * own vocabulary maps onto the controller's codes; anything else is not this
 * endpoint's classification, and the Gateway folds it into `gateway/internal`.
 * @param key - the attempt's wire key.
 * @param method - the requested method, when the page named one.
 * @param error - whatever the attempt threw.
 * @returns the failure to end the stream with.
 */
function remoteFailure(key: string, method: string | undefined, error: unknown): unknown {
  if (error instanceof AuthorizationError) {
    if (error.code === 'ALREADY_IN_FLIGHT') {
      return new RemoteError('authorization/in-flight', error.message, { key }, { cause: error })
    }
    if (error.code === 'NO_FLOW' || error.code === 'UNKNOWN_METHOD') {
      return new RemoteError(
        'authorization/no-flow',
        error.message,
        { key, ...(method === undefined ? {} : { method }) },
        { cause: error },
      )
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return new RemoteError('authorization/failed', message, { key, message }, { cause: error })
}

/**
 * What one attempt stream is opened from, besides the seam and the key.
 */
interface StreamAttemptRequest {
  /** The requested method, when the page named one. */
  readonly method: string | undefined
  /** Carrier cancellation; aborting it withdraws the attempt. */
  readonly signal: AbortSignal
  /** Where the page's answers are delivered. */
  readonly prompts: AttemptRegistry
}

/**
 * Bridge the seam's callback interaction into a pull-driven frame stream. The
 * interaction callbacks fire during `begin()`, while the consumer is pulling
 * the same stream, so frames queue behind an async iterator; the settlement
 * closes it, and a failure ends it in error.
 * @param seam - the authorization service running the attempt.
 * @param key - the branded record address to authorize.
 * @param request - the method, carrier signal, and prompt bookkeeping.
 * @returns the attempt's frames.
 */
function streamAttempt(
  seam: AuthorizationService,
  key: CredentialKey,
  request: StreamAttemptRequest,
): AsyncIterable<AuthorizationAttemptFrame> {
  const { method, signal, prompts } = request
  const wireKey = String(key)
  const buffer: AuthorizationAttemptFrame[] = []
  let failure: { error: unknown } | undefined
  let ended = false
  let waiter: (() => void) | undefined

  const wake = (): void => {
    const resume = waiter
    waiter = undefined
    resume?.()
  }
  const push = (frame: AuthorizationAttemptFrame): void => {
    if (ended) return
    buffer.push(frame)
    wake()
  }
  const fail = (error: unknown): void => {
    if (ended) return
    ended = true
    failure = { error }
    wake()
  }
  const close = (): void => {
    if (ended) return
    ended = true
    wake()
  }

  const running = seam.begin({
    key,
    ...(method === undefined ? {} : { method }),
    signal,
    interaction: {
      notify: (notice) => { push({ kind: 'notice', notice: noticeView(notice) }) },
      prompt: (prompt) => {
        const slot = Promise.withResolvers<string>()
        const promptId = prompts.register(wireKey, {
          resolve: slot.resolve,
          reject: slot.reject,
          view: promptView(prompt),
        })
        // A flow that retires its own prompt — racing a typed code against a
        // browser callback — withdraws the question on the page too.
        prompt.signal?.addEventListener('abort', () => {
          prompts.withdraw(wireKey, promptId)
          push({ kind: 'prompt-withdrawn', promptId })
          /* v8 ignore next -- a fired abort always carries its reason */
          slot.reject(prompt.signal?.reason ?? new Error('the prompt was withdrawn'))
        }, { once: true })
        push({ kind: 'prompt', promptId, prompt: promptView(prompt) })
        return slot.promise
      },
    },
  })
  void running.then(
    (outcome) => {
      prompts.dropAll(wireKey)
      push({ kind: 'settled', status: outcome.status })
      close()
    },
    (error: unknown) => {
      prompts.dropAll(wireKey)
      fail(remoteFailure(wireKey, method, error))
    },
  )
  // The consumer's stream cancellation withdraws the attempt through the
  // signal. This net releases a consumer still waiting on a frame, and its
  // failure is discarded when the settlement already closed the queue.
  signal.addEventListener('abort', () => {
    /* v8 ignore next -- AbortSignal.reason defaults to an AbortError once fired */
    fail(signal.reason ?? new Error('the attempt was cancelled'))
  }, { once: true })

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<AuthorizationAttemptFrame>> {
          for (;;) {
            if (buffer.length > 0) return { value: buffer.shift() as AuthorizationAttemptFrame, done: false }
            if (failure !== undefined) throw failure.error
            if (ended) return { value: undefined, done: true }
            await new Promise<void>((resolve) => { waiter = resolve })
          }
        },
      }
    },
  }
}

declare module '@greeneek/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 * It carries every wire obligation the authorization seam itself does not:
 * key-grammar validation at the parser, one attempt-stream bridge per call,
 * prompt bookkeeping across separate RPC calls, and the refusal mapping.
 * Credential values never cross this namespace in either direction.
 */
export class AuthorizationController extends TypertRemoteService {
  /** Prompts pages can answer, across the calls that answer them. */
  private readonly prompts = new AttemptRegistry()

  /** @param ctx - Host context where the authorization seam may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /**
   * Every registered flow, for a page listing what can be signed into.
   * @returns one view per flow, in registration order.
   * @throws RemoteError when no authorization seam is mounted.
   */
  @Remote
  list(): Promise<AuthorizationEntryView[]> {
    return Promise.resolve(this.seam().list().map(projectEntry))
  }

  /**
   * Run one attempt as a stream. The page reads frames as they happen, answers
   * prompts through `answer()`, and cancels by aborting the stream: the
   * carrier's signal is the request signal the seam withdraws through.
   * @param key - the credential record to authorize, as its `scope/id` string.
   * @param method - which of the flow's methods to run, or `undefined` for its first.
   * @param signal - carrier cancellation; aborting it withdraws the attempt.
   * @returns the attempt's frames, ending with the settlement.
   * @throws RemoteError when the request is malformed, no flow claims the key, it
   *   offers no such method, an attempt is already running, or the flow failed.
   */
  @Remote({ mode: 'stream' })
  attempt(key: string, method: string | undefined, signal: AbortSignal): AsyncIterable<AuthorizationAttemptFrame> {
    return streamAttempt(this.seam(), this.parseKey(key), { method, signal, prompts: this.prompts })
  }

  /**
   * Answer one open prompt of a running attempt.
   * @param key - the attempt's wire key.
   * @param promptId - the id the prompt frame carried.
   * @param answer - the typed or chosen value, or the human's decline.
   * @throws RemoteError when the prompt is not, or is no longer, in flight.
   */
  @Remote
  answer(key: string, promptId: string, answer: AuthorizationAnswer): void {
    this.prompts.answer(this.parseKey(key), promptId, answer)
  }

  /**
   * Withdraw the attempt running for a key, if any. A page that closes its
   * dialog without closing the stream cancels here instead.
   * @param key - the credential record whose attempt should stop, as its `scope/id` string.
   */
  @Remote
  cancel(key: string): void {
    this.seam().cancel(this.parseKey(key))
  }

  /** Resolve the required authorization seam or report how to supply it. */
  private seam(): AuthorizationService {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'authorization service is absent: this deployment does not mount the authorization seam (e.g. @greeneek/gnk-authorization) in its composition',
        {},
      )
    }
    return authorization
  }

  /**
   * Parse one wire key back to its branded record address. A page names the
   * key it listed, so anything outside the record grammar is a malformed
   * request, not a missing flow.
   * @param key - the `scope/id` wire string.
   * @returns the branded credential key.
   * @throws RemoteError code `gateway/bad-request` for a key outside the grammar.
   */
  private parseKey(key: string): CredentialKey {
    const separator = key.indexOf('/')
    const scope = separator === -1 ? '' : key.slice(0, separator)
    const id = key.slice(separator + 1)
    if (scope.length === 0 || id.length === 0 || !isCredentialKeySegment(scope) || !isCredentialKeySegment(id)) {
      throw new RemoteError('gateway/bad-request', `credential key \"${key}\" is not a scope/id pair this server accepts`, {})
    }
    return credentialKey(scope, id)
  }
}

export default AuthorizationController
