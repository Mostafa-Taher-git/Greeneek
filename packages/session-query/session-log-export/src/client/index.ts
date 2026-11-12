/** Browser plugin owning Session export state and its shared modal. */

import type { Context as ClientContext } from '@greeneek/cordis'
import type { SessionId } from '@greeneek/gnk-session/types'
import type {} from '@greeneek/gnk-client-locale/client'
import type {} from '@greeneek/gnk-client-ui-chat/client'
import type {} from '@greeneek/gnk-client-ui-commands/client'
import type {} from '@greeneek/gnk-client-ui-conversation/client'
import type {} from '@greeneek/gnk-client-ui-renderer/client'
import type {} from '@greeneek/gnk-client-ui-session/client'
import { SessionLogDownloadController } from './controller.ts'
import { SessionExportActions, type SessionExportActionsInjected } from './DetailsActions.tsx'
import { SessionMarkdownCopyController } from './markdown-controller.ts'
import { ar, en, NS, zh, type SessionLogDownloadKey } from './locales.ts'

declare module '@greeneek/cordis' {
  interface Context {
    sessionLogDownload: SessionLogDownloadController
    sessionMarkdownCopy: SessionMarkdownCopyController
  }
}

declare module '@greeneek/gnk-client-ui-slots' {
  interface LocaleNamespaceMap {
    'session-log-download': SessionLogDownloadKey
  }
}

export type { SessionLogDownloadEntry, SessionLogDownloadState } from './controller.ts'
export type { SessionMarkdownCopyEntry, SessionMarkdownCopyState } from './markdown-controller.ts'

export const inject = ['slots', 'locale']

/**
 * Provide the export controllers and mount the Session export actions in Thread Details.
 * @param ctx - browser context carrying slots and locale services.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionLogDownloadController()
  const markdown = new SessionMarkdownCopyController(
    (input, init) => fetch(input, init),
    undefined,
    ctx.locale.bind(NS),
  )
  ctx.provide('sessionLogDownload', controller)
  ctx.provide('sessionMarkdownCopy', markdown)
  ctx.effect(() => async () => {
    await controller.dispose()
    await markdown.dispose()
  }, 'session-log-download: browser download lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'session-log-download: browser dictionaries')
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'export' && result.kind === 'success') void controller.download(sessionId)
  })
  // Thread Details owns the Session's transcript actions: the copy, the log
  // download, and the trajectory, so the Session Header carries no duplicate
  // menu for the same verbs.
  ctx.slots.inject('conversation.details.actions', () => ctx.slots.register({
    name: 'conversation.details.actions',
    id: 'session-export',
    locale: NS,
    inject: (): SessionExportActionsInjected => ({
      hooks: {
        sessionLogDownload: controller.store,
        sessionMarkdownCopy: markdown.store,
      },
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      copyMarkdown: (sessionId: SessionId, title: string) => markdown.copyAsMarkdown(sessionId, title),
      clearCopy: (sessionId: SessionId) => { markdown.clear(sessionId) },
    }),
  }, SessionExportActions))
}

export type { SessionExportActionsInjected, SessionExportActionsProps } from './DetailsActions.tsx'
