/**
 * Thread Details: the card at the top of the details column.
 *
 * Shape follows T3's thread panel: one 280px-wide rounded card of 32px rows
 * with muted 16px icons, grouped into sections that each own a divider. The
 * card names the Session's workspace and version-control facts, hosts every
 * Session-scoped control as an action row (the slots other packages fill),
 * and shows lineage only while a lineage renderer occupies its hole.
 *
 * The column stays mounted while closed, so the Session keyboard shortcuts
 * here stay live with the panel shut.
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  formatShortcut,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCopyOutline16,
  IconEllipsisOutline16,
  IconFileDiff16,
  IconFolderOpenOutline16,
  IconGitHubDesktop16,
  IconMonitor16,
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
import type {
  GitFacts, OpenPathTarget, ThreadDetailsPanelProps,
} from './contract/slots.ts'
import { formatCount, pathBasename } from './format.ts'
import { fileManagerLabel, openInMenuItems, openInTarget } from './openInMenu.tsx'
import { sharedSessionMenuItems } from './sessionMenuItems.tsx'
import { useExternalApps } from './useExternalApps.ts'
import css from './ThreadDetailsPanel.module.css'

/**
 * Render the Thread Details card.
 * @param props - composed slot props: Session scope, both inner holes, injected verbs, locale seat.
 * @returns the card and its rename/delete dialogs.
 */
export function ThreadDetailsPanel({
  sessionId,
  useSessions,
  useWorkspaces,
  renderSlot,
  useLineage,
  useFleet,
  useHostInfo,
  t,
  pinSession,
  archiveSession,
  deleteSession,
  renameSession,
  forkSession,
  externalApps,
  openPath,
  gitFacts,
  gitPush,
  toggleDetails,
  toggleTerminalDrawer,
  toggleRightPanel,
}: ThreadDetailsPanelProps) {
  const title = useSessions(state => state.byId[sessionId]?.title ?? '')
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  const isPinned = pinnedSessionIds.includes(sessionId)
  const lineageOccupied = useLineage(occupied => occupied)
  const fleetOccupied = useFleet(occupied => occupied)
  const hostname = useHostInfo(info => info.hostname)
  const appsShare = useExternalApps(externalApps)
  const [git, setGit] = useState<GitFacts | undefined>(undefined)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitError, setGitError] = useState<string>()
  const [deviceCopied, setDeviceCopied] = useState(false)
  const [appsMenuOpen, setAppsMenuOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
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
      } else if (shortcutMatches(event, 'mod+shift+b')) {
        event.preventDefault()
        toggleDetails()
      } else if (shortcutMatches(event, 'mod+j') || shortcutMatches(event, 'mod+t')) {
        event.preventDefault()
        toggleTerminalDrawer()
      } else if (shortcutMatches(event, 'mod+alt+b')) {
        event.preventDefault()
        toggleRightPanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [sessionId, title, forkSession, archiveSession, toggleDetails, toggleTerminalDrawer, toggleRightPanel])

  // The copy confirmation is transient feedback, not durable state.
  useEffect(() => {
    if (!deviceCopied) return
    const timer = setTimeout(() => { setDeviceCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [deviceCopied])

  // Version-control facts belong to the workspace directory, so they are read
  // once per directory and dropped while the next Session's directory loads.
  useEffect(() => {
    setGit(undefined)
    if (cwd === undefined || cwd === '') return
    let cancelled = false
    gitFacts(cwd)
      .then((facts) => {
        if (!cancelled) setGit(facts)
      })
      .catch((reason: unknown) => {
        // Advisory: a directory outside a repository simply shows no section.
        console.warn('workspace git facts unavailable:', reason)
      })
    return () => { cancelled = true }
  }, [cwd, gitFacts])

  const workspaceName = cwd === undefined || cwd === '' ? undefined : pathBasename(cwd)
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

  const pushBranch = (): void => {
    if (cwd === undefined || cwd === '' || gitBusy) return
    setGitBusy(true)
    setGitError(undefined)
    gitPush(cwd)
      .then(() => { setGitBusy(false) })
      .catch((reason: unknown) => {
        setGitBusy(false)
        setGitError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  const handleSelectApp = (id: string): void => {
    setAppsMenuOpen(false)
    openDestination(openInTarget(id))
  }

  // The card owns one place per verb: pin and archive are visible controls,
  // and the overflow menu holds only the verbs with no visible button.
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

  const branchLabel = git?.branch === undefined ? t('git.detachedHead') : t('git.branchName', { branch: git.branch })
  const changesLabel = git === undefined
    ? ''
    : git.baseBranch === undefined
      ? t('git.changesUnbasedLabel')
      : t('git.changesLabel', { base: git.baseBranch })
  const changesCounts = git === undefined
    ? ''
    : t('git.changesCounts', {
      added: formatCount(git.insertions),
      removed: formatCount(git.deletions),
    })

  return (
    <div className={css.card}>
      {(hostname !== undefined || workspaceName !== undefined) && (
        <section className={css.section}>
          {hostname !== undefined && (
            <div className={css.row}>
              <IconMonitor16 className={css.icon} />
              <span className={css.label}>{hostname}</span>
              <Tooltip
                label={deviceCopied ? t('actions.copiedDevice.aria') : t('actions.copyDevice.aria')}
                delayMs={500}
              >
                <button
                  type="button"
                  className={css.rowAction}
                  aria-label={deviceCopied ? t('actions.copiedDevice.aria') : t('actions.copyDevice.aria')}
                  onClick={() => {
                    void writeClipboard(hostname).then((accepted) => {
                      if (accepted) setDeviceCopied(true)
                    })
                  }}
                >
                  {deviceCopied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
                </button>
              </Tooltip>
            </div>
          )}
          {workspaceName !== undefined && (
            <div className={css.splitGroup}>
              <Tooltip label={defaultLabel} delayMs={500}>
                <button
                  type="button"
                  className={css.splitPrimary}
                  aria-label={t('actions.openWorkspace.aria', { name: workspaceName })}
                  onClick={() => { openDestination({ kind: 'default' }) }}
                >
                  <IconFolderOpenOutline16 className={css.icon} />
                  <span className={css.label}>{workspaceName}</span>
                </button>
              </Tooltip>
              <span className={css.splitDivider} aria-hidden="true" />
              <Menu
                open={appsMenuOpen}
                anchor={(
                  <button
                    type="button"
                    className={css.splitSecondary}
                    onClick={() => { setAppsMenuOpen(value => !value) }}
                    aria-label={t('actions.openIn.aria')}
                    aria-expanded={appsMenuOpen}
                  >
                    <IconChevronDownOutline14 />
                  </button>
                )}
                items={openInItems}
                onSelect={handleSelectApp}
                onClose={() => { setAppsMenuOpen(false) }}
                portal
              />
            </div>
          )}
          {openError !== null && (
            <div className={css.error} role="alert">{openError}</div>
          )}
        </section>
      )}

      <section className={css.section}>
        <div className={css.actionRow}>
          <div className={css.chips}>
            {renderSlot('conversation.details.thread.action', {})}
          </div>
          <div className={css.controls}>
            <Tooltip label={isPinned ? t('menu.unpin') : t('menu.pin')} delayMs={500}>
              <button
                type="button"
                className={clsx(css.iconButton, isPinned && css.pinnedActive)}
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
                className={css.iconButton}
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
                    className={css.iconButton}
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
          </div>
        </div>
      </section>

      {git !== undefined && git.isRepository && (
        <section className={css.section}>
          <div className={css.row}>
            <IconBranchOutline16 className={css.icon} />
            <span className={css.label}>{branchLabel}</span>
            <Tooltip label={t('git.copyBranch')} delayMs={500}>
              <button
                type="button"
                className={css.rowAction}
                aria-label={t('git.copyBranch')}
                onClick={() => { void writeClipboard(git.branch ?? '') }}
              >
                <IconChevronDownOutline14 />
              </button>
            </Tooltip>
          </div>
          <button
            type="button"
            className={css.pushRow}
            aria-label={t('git.push')}
            disabled={gitBusy}
            onClick={pushBranch}
          >
            <IconGitHubDesktop16 className={css.icon} />
            <span className={css.label}>{t('git.push')}</span>
            <IconChevronDownOutline14 />
          </button>
          <div className={css.row}>
            <IconFileDiff16 className={css.icon} />
            <span className={css.label}>{changesLabel}</span>
            <span className={css.rowValue}>{changesCounts}</span>
          </div>
          {gitError !== undefined && <div className={css.error} role="alert">{gitError}</div>}
        </section>
      )}

      {lineageOccupied && (
        <section className={css.section}>
          <h3 className={css.heading}>{t('panel.lineage')}</h3>
          {renderSlot('conversation.details.thread.lineage', {
            lineageSessionId: sessionId,
            displayTitle: title,
          })}
        </section>
      )}

      {fleetOccupied && (
        <section className={css.section}>
          <h3 className={css.heading}>{t('panel.liveFleet')}</h3>
          {renderSlot('conversation.details.thread.fleet', {})}
        </section>
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
          <div className={css.error} role="alert">{renameError}</div>
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
          <div className={css.error} role="alert">{deleteError}</div>
        )}
      </Modal>
    </div>
  )
}
