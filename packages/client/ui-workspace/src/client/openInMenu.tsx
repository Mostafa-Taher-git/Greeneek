/**
 * The shared "Open in…" destination menu.
 *
 * The Session header and the Workspace row offer the same destinations: the
 * desktop's default application, the system file manager, and the applications
 * the Host reports as installed. The catalogue is a Host fact, so the menu is
 * derived from it on every read and never offers an application the Host
 * cannot start.
 */
import {
  IconAndroidStudio16,
  IconCursor16,
  IconFolderOpen16,
  IconFolderOpenOutline16,
  IconGitHubDesktop16,
  IconVSCode16,
  type MenuItem,
} from '@greeneek/gnk-client-ui-primitives'
import type { ExternalAppsShare, OpenPathTarget, WorkspaceBrowserProps } from './contract/slots.ts'
import css from './SessionHeaderUtilities.module.css'

/** Menu item id of the default-application destination. */
const DEFAULT_ITEM_ID = 'open-in:default'
/** Menu item id of the file-manager destination. */
const REVEAL_ITEM_ID = 'open-in:reveal'
/** Menu item id prefix of one catalogued application. */
export const OPEN_IN_APP_PREFIX = 'open-in:app:'

/** The applications the Client can name, with the glyph each one shows. */
const APPLICATION_ITEMS = [
  { id: 'cursor', labelKey: 'openIn.app.cursor', Glyph: IconCursor16 },
  { id: 'vscode', labelKey: 'openIn.app.vscode', Glyph: IconVSCode16 },
  { id: 'android-studio', labelKey: 'openIn.app.android-studio', Glyph: IconAndroidStudio16 },
  { id: 'github-desktop', labelKey: 'openIn.app.github-desktop', Glyph: IconGitHubDesktop16 },
] as const

/**
 * Name the system file manager for one host platform.
 * @param platform - Host platform from the catalogue, or undefined while loading.
 * @param t - the workspace locale seat.
 * @returns the localized default-application label.
 */
export function fileManagerLabel(
  platform: ExternalAppsShare['platform'] | undefined,
  t: WorkspaceBrowserProps['t'],
): string {
  if (platform === 'darwin') return t('openIn.default.darwin')
  if (platform === 'linux') return t('openIn.default.linux')
  if (platform === 'win32') return t('openIn.default.win32')
  return t('openIn.folder')
}

/**
 * Build the "Open in…" menu rows for one Host catalogue.
 * @param share - the Host catalogue, or undefined while it is loading.
 * @param t - the workspace locale seat.
 * @returns the menu rows in presentation order.
 */
export function openInMenuItems(
  share: ExternalAppsShare | undefined,
  t: WorkspaceBrowserProps['t'],
): MenuItem[] {
  const items: MenuItem[] = [{
    id: DEFAULT_ITEM_ID,
    label: fileManagerLabel(share?.platform, t),
    icon: <IconFolderOpen16 className={css.folderIcon} />,
  }]
  if (share?.canReveal === true) {
    items.push({
      id: REVEAL_ITEM_ID,
      label: t('menu.showInFolder'),
      icon: <IconFolderOpenOutline16 />,
    })
  }
  for (const app of share?.apps ?? []) {
    if (!app.available) continue
    const entry = APPLICATION_ITEMS.find(candidate => candidate.id === app.id)
    // An application the Client has no name for is not offered: a raw id
    // would reach the user as an untranslated token.
    if (entry === undefined) continue
    items.push({
      id: `${OPEN_IN_APP_PREFIX}${app.id}`,
      label: t(entry.labelKey),
      icon: <entry.Glyph />,
    })
  }
  return items
}

/**
 * Resolve one "Open in…" row id to the Host destination it names.
 * @param id - the selected row id.
 * @returns the destination the Host receives.
 */
export function openInTarget(id: string): OpenPathTarget {
  if (id === DEFAULT_ITEM_ID) return { kind: 'default' }
  if (id === REVEAL_ITEM_ID) return { kind: 'reveal' }
  return { kind: 'app', appId: id.slice(OPEN_IN_APP_PREFIX.length) }
}
