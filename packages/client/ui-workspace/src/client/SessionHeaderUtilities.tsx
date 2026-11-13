/**
 * Session header utilities: the workspace folder split-opener, pin and archive
 * shortcuts, the session overflow menu, and the three workspace panel toggles.
 *
 * The header is session-scoped, so the title comes from the global Session
 * list snapshot rather than the lifecycle snapshot, which carries control
 * state only. External applications are host facts read on mount; a failed
 * read leaves the system file-manager entry available on its own.
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { SessionId } from '@greeneek/gnk-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import {
  Button,
  formatShortcut,
  IconArchiveOutline20,
  IconChevronDownOutline14,
  IconEllipsisOutline16,
  IconFolderOpen16,
  IconCodeOutline16,
  IconInfoOutline16,
  IconPanelRightOutline16,
  IconPinFill16,
  IconTrashOutline16,
  Menu,
  Modal,
  isEditableTarget,
  shortcutMatches,
  Tooltip,
  writeClipboard,
  type MenuItem,
} from '@greeneek/gnk-client-ui-primitives'
import type { ExternalAppsShare, OpenPathTarget } from './contract/slots.ts'
import { fileManagerLabel, openInMenuItems, openInTarget } from './openInMenu.tsx'
import { sharedSessionMenuItems } from './sessionMenuItems.tsx'
import { useExternalApps } from './useExternalApps.ts'
import css from './SessionHeaderUtilities.module.css'

/** Injected capability face for session header utilities. */
export interface SessionHeaderUtilitiesInjected {
  /** Pin or unpin this Session in the registry-global pin set. */
  pinSession: (sessionId: SessionId, pinned: boolean) => Promise<void>
  /** Archive this Session into the registry-global archive set. */
  archiveSession: (sessionId: SessionId) => Promise<void>
  /** Delete this Session permanently, including its stored log. */
  deleteSession: (sessionId: SessionId) => Promise<void>
  /** Rename this Session. */
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  /** Fork this Session at its last completed turn. */
  forkSession: (sessionId: SessionId) => void
  /** Read the Host external application catalogue and platform facts. */
  externalApps: () => Promise<ExternalAppsShare>
  /** Hand this Session's workspace directory to a Host desktop destination. */
  openPath: (sessionId: SessionId, target: OpenPathTarget) => Promise<void>
}

/** Composed slot props for the header utilities. */
export type SessionHeaderUtilitiesProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'workspace'>
  & InjectFace<SessionHeaderUtilitiesInjected>

/**
 * Render the session header utility cluster.
 * @param props - composed slot props with the session identity and injected actions.
 * @returns the utility cluster and its rename/delete dialogs.
 */
export function SessionHeaderUtilities({
  sessionId,
  useSessions,
  useWorkspaces,
  t,
  pinSession,
  archiveSession,
  deleteSession,
  renameSession,
  forkSession,
  externalApps,
  openPath,
  panelControls,
}: SessionHeaderUtilitiesProps) {
  const title = useSessions(state => state.byId[sessionId]?.title ?? '')
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  const isPinned = pinnedSessionIds.includes(sessionId)
  const appsShare = useExternalApps(externalApps)
  const [appsMenuOpen, setAppsMenuOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  // The desktop titlebar carries the three panel toggles when the preload
  // bridge is present (mirrors the frame's host detection). The web host has
  // no titlebar row, so the session header keeps the same three toggles.
  const [desktopHost] = useState(
    () => (globalThis as { greeneekDesktop?: unknown }).greeneekDesktop !== undefined,
  )
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if (shortcutMatches(event, 'mod+alt+g')) {
        event.preventDefault()
        setRenameDraft(title)
        setRenameError(null)
        setRenameOpen(true)
      } else if (shortcutMatches(event, 'mod+alt+f')) {
        event.preventDefault()
        forkSession(sessionId)
      } else if (shortcutMatches(event, 'mod+shift+a')) {
        event.preventDefault()
        archiveSession(sessionId).catch((reason: unknown) => {
          console.warn('session archive rejected:', reason)
        })
      } else if (panelControls !== undefined && shortcutMatches(event, 'mod+shift+b')) {
        event.preventDefault()
        panelControls.toggleThreadDetails()
      } else if (panelControls !== undefined && shortcutMatches(event, 'mod+j')) {
        event.preventDefault()
        panelControls.toggleTerminalDrawer()
      } else if (panelControls !== undefined && shortcutMatches(event, 'mod+alt+b')) {
        event.preventDefault()
        panelControls.toggleRightPanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [sessionId, title, forkSession, archiveSession, panelControls])

  const defaultLabel = fileManagerLabel(appsShare?.platform, t)
  const openInItems: MenuItem[] = useMemo(() => openInMenuItems(appsShare, t), [appsShare, t])

  const openDestination = (target: OpenPathTarget): void => {
    setOpenError(null)
    openPath(sessionId, target).catch((reason: unknown) => {
      // The Host refused the destination (no directory, no file manager, no
      // application): the reason belongs in front of the user, not only in the log.
      setOpenError(reason instanceof Error ? reason.message : String(reason))
      console.warn('session path open rejected:', reason)
    })
  }

  const handleSelectApp = (id: string): void => {
    setAppsMenuOpen(false)
    openDestination(openInTarget(id))
  }

  // The header cluster owns one place per verb: the pin and archive buttons
  // are always visible, and the open-in split carries the file-manager entry.
  // The overflow menu therefore holds only the verbs with no visible button.
  const sessionMenuItems: MenuItem[] = [
    ...sharedSessionMenuItems(t),
    {
      id: 'delete',
      label: t('menu.deleteSession'),
      icon: <IconTrashOutline16 />,
      danger: true,
    },
  ]

  const handleSelectAction = (id: string): void => {
    setActionsMenuOpen(false)
    switch (id) {
      case 'rename':
        setRenameDraft(title)
        setRenameError(null)
        setRenameOpen(true)
        break
      case 'fork':
        forkSession(sessionId)
        break
      case 'copy-id':
        void writeClipboard(sessionId)
        break
      case 'delete':
        setDeleteError(null)
        setDeleteOpen(true)
        break
    }
  }

  const handleConfirmRename = (): void => {
    const trimmed = renameDraft.trim()
    if (trimmed === '' || renaming) return
    setRenaming(true)
    setRenameError(null)
    renameSession(sessionId, trimmed)
      .then(() => { setRenameOpen(false) })
      .catch((reason: unknown) => {
        setRenameError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setRenaming(false) })
  }

  const handleConfirmDelete = (): void => {
    setDeleting(true)
    setDeleteError(null)
    deleteSession(sessionId)
      .then(() => { setDeleteOpen(false) })
      .catch((reason: unknown) => {
        setDeleteError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setDeleting(false) })
  }

  return (
    <div className={css.utilitiesRoot}>
      <div className={css.openInSplit}>
        <Tooltip label={defaultLabel} delayMs={500}>
          <button
            type="button"
            className={css.splitMain}
            onClick={() => { openDestination({ kind: 'default' }) }}
            aria-label={defaultLabel}
          >
            <IconFolderOpen16 className={css.folderIcon} />
          </button>
        </Tooltip>
        <span className={css.splitDivider} aria-hidden="true" />
        <Menu
          open={appsMenuOpen}
          anchor={(
            <button
              type="button"
              className={css.splitArrow}
              onClick={() => { setAppsMenuOpen(value => !value) }}
              aria-label={t('actions.openIn.aria')}
              aria-expanded={appsMenuOpen}
            >
              <IconChevronDownOutline14 />
            </button>
          )}
          className={clsx(css.openInMenu)}
          items={openInItems}
          onSelect={handleSelectApp}
          onClose={() => { setAppsMenuOpen(false) }}
          portal
        />
      </div>

      <Tooltip label={isPinned ? t('menu.unpin') : t('menu.pin')} delayMs={500}>
        <button
          type="button"
          className={clsx(css.headerBtn, isPinned && css.pinnedActive)}
          onClick={() => {
            pinSession(sessionId, !isPinned).catch((reason: unknown) => {
              console.warn('session pin rejected:', reason)
            })
          }}
          aria-label={isPinned ? t('actions.unpinSession.aria') : t('actions.pinSession.aria')}
        >
          <IconPinFill16 />
        </button>
      </Tooltip>

      <Tooltip label={`${t('menu.archiveSession')} (${formatShortcut('mod+shift+a')})`} delayMs={500}>
        <button
          type="button"
          className={css.headerBtn}
          onClick={() => {
            archiveSession(sessionId).catch((reason: unknown) => {
              console.warn('session archive rejected:', reason)
            })
          }}
          aria-label={t('actions.archiveSession.aria')}
        >
          <IconArchiveOutline20 size={16} />
        </button>
      </Tooltip>

      <Menu
        open={actionsMenuOpen}
        anchor={(
          <Tooltip label={t('actions.moreSession.aria')} delayMs={500} disabled={actionsMenuOpen}>
            <button
              type="button"
              className={css.headerBtn}
              onClick={() => { setActionsMenuOpen(value => !value) }}
              aria-label={t('actions.moreSession.aria')}
              aria-expanded={actionsMenuOpen}
            >
              <IconEllipsisOutline16 />
            </button>
          </Tooltip>
        )}
        items={sessionMenuItems}
        onSelect={handleSelectAction}
        onClose={() => { setActionsMenuOpen(false) }}
        portal
      />

      {panelControls !== undefined && !desktopHost && (
        <>
          <Tooltip label={t('actions.toggleThreadDetails.aria')} delayMs={500}>
            <button
              type="button"
              className={css.headerBtn}
              onClick={panelControls.toggleThreadDetails}
              aria-label={t('actions.toggleThreadDetails.aria')}
              aria-pressed={panelControls.threadDetailsOpen}
            >
              <IconInfoOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('actions.toggleTerminalDrawer.aria')} delayMs={500}>
            <button
              type="button"
              className={css.headerBtn}
              onClick={panelControls.toggleTerminalDrawer}
              aria-label={t('actions.toggleTerminalDrawer.aria')}
              aria-pressed={panelControls.terminalDrawerOpen}
            >
              <IconCodeOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('actions.toggleRightPanel.aria')} delayMs={500}>
            <button
              type="button"
              className={css.headerBtn}
              onClick={panelControls.toggleRightPanel}
              aria-label={t('actions.toggleRightPanel.aria')}
              aria-pressed={panelControls.rightPanelOpen}
            >
              <IconPanelRightOutline16 />
            </button>
          </Tooltip>
        </>
      )}
      {openError !== null && (
        <div className={css.renameError} role="alert">{openError}</div>
      )}

      <Modal
        open={renameOpen}
        onClose={() => { setRenameOpen(false) }}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={() => { setRenameOpen(false) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={renaming || renameDraft.trim() === ''}
              onClick={handleConfirmRename}
            >
              {t('rename')}
            </Button>
          </>
        )}
      >
        <input
          autoFocus
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.sessionName')}
          disabled={renaming}
          onChange={(event) => {
            setRenameDraft(event.target.value)
            setRenameError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleConfirmRename()
            }
          }}
        />
        {renameError !== null && (
          <div className={css.renameError} role="alert">{renameError}</div>
        )}
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false) }}
        closeLabel={t('close')}
        title={t('delete.session')}
        description={t('delete.sessionDesc', { name: title })}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={() => { setDeleteOpen(false) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={handleConfirmDelete}
            >
              {t('delete.session')}
            </Button>
          </>
        )}
      >
        {deleteError !== null && (
          <div className={css.renameError} role="alert">{deleteError}</div>
        )}
      </Modal>
    </div>
  )
}
