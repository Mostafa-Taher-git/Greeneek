/**
 * Independent right panel: a T3-style "Open a surface" launcher plus a tabbed
 * surface stack. The eight launcher rows and the Browser profile submenu mirror
 * T3 Code; every opened surface is backed by a Host capability. Rows whose
 * backend is still landing are disabled with an explicit reason rather than
 * presented as working controls.
 */
import { useEffect, useState } from 'react'
import {
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconCodeOutline16,
  IconFileDiff16,
  IconFolderOpenOutline16,
  IconGitHubDesktop16,
  IconMonitor16,
  IconNewChatOutline16,
  IconSettingsOutline16,
  IconDashboardOutline16,
  formatShortcut,
  isEditableTarget,
  shortcutMatches,
  type IconProps,
} from '@greeneek/gnk-client-ui-primitives'
import type { SurfacePanelComponentProps } from './contract/slots.ts'
import type { SidebarKey } from './locales.ts'
import type { SurfaceKind } from './right-panel-store.ts'
import { DevicePanel } from './surfaces/DevicePanel.tsx'
import { DiffPanel } from './surfaces/DiffPanel.tsx'
import { FilesPanel } from './surfaces/FilesPanel.tsx'
import css from './SurfacePanel.module.css'

/** One launcher row: glyph, localized name, shortcut, destination. */
interface SurfaceSpec {
  /** Stable row identity. */
  id: SurfaceKind
  /** The glyph. */
  icon: (props: IconProps) => React.ReactNode
  /** Localized row name. */
  labelKey: SidebarKey
  /** Single-key launcher shortcut spelled as a spec. */
  shortcut: string
  /** True only when the backing capability is live. */
  ready: boolean
}

/** Browser profile choices, matching T3's built-in partitions. */
const BROWSER_PROFILES = [
  { id: 'default', labelKey: 'surface.profile.default' as const },
  { id: 'incognito', labelKey: 'surface.profile.incognito' as const },
]

/**
 * Render the right-panel launcher or the active surface.
 * @param props - session scope, injected verbs, surface store, locale seat.
 * @returns the launcher rows or the tabbed surface view.
 */
export function SurfacePanel(props: SurfacePanelComponentProps) {
  const {
    sessionId, useStore, actions, openTerminal, openTrajectory, openChat,
    openSettings, openDashboard, loadDevice, browseFiles, readFile, loadDiff, useSessions, t,
  } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const surfaces = useStore(state => state.surfaces)
  const activeId = useStore(state => state.activeId)
  const active = surfaces.find(surface => surface.id === activeId)
  const [profileOpen, setProfileOpen] = useState(false)

  // The single-key launcher shortcut for Files. Other rows bind their own
  // shortcuts as their backends land.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if (shortcutMatches(event, 'mod+f')) {
        event.preventDefault()
        actions.open({ kind: 'files', title: t('surface.files'), data: {} }, true)
        return
      }
      if (shortcutMatches(event, 'mod+d')) {
        event.preventDefault()
        actions.open({ kind: 'diff', title: t('surface.diff'), data: {} }, true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [actions, t])

  const specifications: SurfaceSpec[] = [
    { id: 'browser', icon: IconCodeOutline16, labelKey: 'surface.browser', shortcut: 'b', ready: false },
    { id: 'terminal', icon: IconCodeOutline16, labelKey: 'surface.terminal', shortcut: 't', ready: true },
    { id: 'files', icon: IconFolderOpenOutline16, labelKey: 'surface.files', shortcut: 'f', ready: true },
    { id: 'diff', icon: IconFileDiff16, labelKey: 'surface.diff', shortcut: 'd', ready: true },
    { id: 'pull-request', icon: IconGitHubDesktop16, labelKey: 'surface.pullRequest', shortcut: 'p', ready: false },
    { id: 'linked-pull-requests', icon: IconBranchOutline16, labelKey: 'surface.linkedPullRequests', shortcut: 'l', ready: false },
    { id: 'device', icon: IconMonitor16, labelKey: 'surface.device', shortcut: 'm', ready: true },
    { id: 'side-chat', icon: IconNewChatOutline16, labelKey: 'surface.sideChat', shortcut: 's', ready: false },
  ]

  const openSurface = (spec: SurfaceSpec, data: Record<string, string> = {}): void => {
    if (!spec.ready) return
    if (spec.id === 'terminal') { openTerminal(); return }
    actions.open({ kind: spec.id, title: t(spec.labelKey), data }, true)
  }

  const legacyRows = [
    { key: 'surface.trajectory' as const, icon: IconBranchOutline16, open: () => { openTrajectory(sessionId) } },
    { key: 'surface.chat' as const, icon: IconNewChatOutline16, open: () => { openChat(sessionId) } },
    { key: 'surface.settings' as const, icon: IconSettingsOutline16, open: openSettings },
    { key: 'surface.dashboard' as const, icon: IconDashboardOutline16, open: openDashboard },
  ]

  return (
    <div className={css.root} data-surface-panel="">
      {surfaces.length > 0 && (
        <div className={css.tabs}>
          {surfaces.map(surface => (
            <div key={surface.id} className={css.tab}>
              <button
                type="button"
                className={surface.id === activeId ? css.tabActive : css.tab}
                onClick={() => { actions.activate(surface.id) }}
              >
                {surface.title}
              </button>
              <button
                type="button"
                className={css.tabClose}
                aria-label={`${t('surface.close')}: ${surface.title}`}
                onClick={() => { actions.close(surface.id) }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={css.launcherButton}
            onClick={() => { actions.closeAll() }}
          >
            +
          </button>
        </div>
      )}

      {active === undefined && (
        <>
          <h2 className={css.heading}>{t('surface.heading')}</h2>
          <div className={css.list}>
            {specifications.map(spec => (
              <div key={spec.id} className={css.rowWrap}>
                <button
                  type="button"
                  className={css.row}
                  aria-label={t(spec.labelKey)}
                  disabled={!spec.ready}
                  title={spec.ready ? undefined : t('surface.pendingBackend')}
                  onClick={() => { openSurface(spec) }}
                >
                  <spec.icon size={16} className={css.icon} />
                  <span className={css.label}>{t(spec.labelKey)}</span>
                  <kbd className={css.shortcut}>{formatShortcut(spec.shortcut)}</kbd>
                </button>
                {spec.id === 'browser' && (
                  <>
                    <button
                      type="button"
                      className={css.submenuToggle}
                      aria-label={t('surface.openProfile')}
                      aria-expanded={profileOpen}
                      onClick={() => { setProfileOpen(value => !value) }}
                    >
                      <IconChevronDownOutline14 />
                    </button>
                    {profileOpen && (
                      <div className={css.submenu}>
                        {BROWSER_PROFILES.map(profile => (
                          <button
                            key={profile.id}
                            type="button"
                            className={css.submenuRow}
                            disabled
                            onClick={() => {
                              actions.open({
                                kind: 'browser', title: t(profile.labelKey), data: { profile: profile.id },
                              }, true)
                            }}
                          >
                            {t(profile.labelKey)}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {legacyRows.map(row => (
              <button key={row.key} type="button" className={css.row} aria-label={t(row.key)} onClick={row.open}>
                <row.icon size={16} className={css.icon} />
                <span className={css.label}>{t(row.key)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {active !== undefined && (
        <div className={css.surfaceBody}>
          {active.kind === 'device'
            ? <DevicePanel loadDevice={loadDevice} t={t} />
            : active.kind === 'files'
              ? <FilesPanel browseFiles={browseFiles} readFile={readFile} t={t} />
              : active.kind === 'diff'
                ? <DiffPanel cwd={cwd} loadDiff={loadDiff} t={t} />
                : <div className={css.notice}>{t('surface.pendingBackend')}</div>}
        </div>
      )}
    </div>
  )
}
