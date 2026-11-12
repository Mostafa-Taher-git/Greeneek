/**
 * Copy one Session's transcript to the clipboard as Markdown.
 *
 * The copy reads the Session's durable log through the same archive the
 * download offers, so the pasted transcript and the downloaded log describe
 * the same Session.
 */
import { createSnapshotStore, type SnapshotStore } from '@greeneek/gnk-client-store'
import { writeClipboard } from '@greeneek/gnk-client-ui-primitives'
import type { SessionId } from '@greeneek/gnk-session/types'
import { fetchSessionMarkdown } from './markdown-source.ts'
import { SessionOperationRegistry } from './session-operations.ts'

/** The phases one copy presents. */
export type SessionMarkdownCopyStatus = 'idle' | 'copying' | 'copied' | 'error'

/** One Session's copy state. */
export interface SessionMarkdownCopyEntry {
  readonly status: SessionMarkdownCopyStatus
  readonly error: string | null
}

/** Copy states keyed by the Session whose Thread Details owns the button. */
export interface SessionMarkdownCopyState {
  bySession: Record<string, SessionMarkdownCopyEntry | undefined>
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>
type Copy = (text: string) => boolean | Promise<boolean>

const INITIAL: SessionMarkdownCopyState = { bySession: {} }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The headings the exported document uses; the controller reads them from the locale. */
export type SessionMarkdownTranslator = (key: 'markdown.user' | 'markdown.assistant' | 'markdown.tool' | 'markdown.result') => string

/** Owns one in-flight clipboard copy per Session and publishes its state. */
export class SessionMarkdownCopyController {
  /** uSES-safe state source shared by every Session-scoped contribution. */
  readonly store: SnapshotStore<SessionMarkdownCopyState> = createSnapshotStore(INITIAL)

  private readonly operations = new SessionOperationRegistry()

  /**
   * @param fetcher - HTTP carrier used to read the host-streamed archive.
   * @param copy - clipboard write operation.
   * @param t - translator for the exported document's headings.
   */
  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly copy: Copy = writeClipboard,
    private readonly t: SessionMarkdownTranslator = key => key,
  ) {}

  /**
   * Copy one Session's transcript as Markdown; concurrent gestures for the same Session share one operation.
   * @param sessionId - root Session whose transcript is copied.
   * @param title - the Session's display title, which names the document.
   * @returns after the clipboard write settles, an error is published, or a late post-disposal request is ignored.
   */
  copyAsMarkdown(sessionId: SessionId, title: string): Promise<void> {
    return this.operations.run(sessionId, signal => this.run(sessionId, title, signal))
  }

  /**
   * Clear one Session's copy state, so the button returns to its idle label.
   * @param sessionId - Session whose copy state is cleared.
   */
  clear(sessionId: SessionId): void {
    this.publish(sessionId, { status: 'idle', error: null })
  }

  /**
   * Abort active reads and reach quiescence.
   * @returns after every active operation settles.
   */
  async dispose(): Promise<void> {
    await this.operations.dispose()
  }

  private async run(sessionId: SessionId, title: string, signal: AbortSignal): Promise<void> {
    this.publish(sessionId, { status: 'copying', error: null })
    try {
      const markdown = await fetchSessionMarkdown(this.fetcher, sessionId, title, {
        user: this.t('markdown.user'),
        assistant: this.t('markdown.assistant'),
        tool: this.t('markdown.tool'),
        result: this.t('markdown.result'),
      }, signal)
      const written = await this.copy(markdown)
      if (!written) {
        throw new Error('The clipboard rejected the transcript')
      }
      this.publish(sessionId, { status: 'copied', error: null })
    } catch (error: unknown) {
      if (signal.aborted) return
      this.publish(sessionId, { status: 'error', error: messageOf(error) })
    }
  }

  private publish(sessionId: SessionId, entry: SessionMarkdownCopyEntry): void {
    this.store.update((state) => {
      state.bySession = { ...state.bySession, [String(sessionId)]: entry }
    })
  }
}
