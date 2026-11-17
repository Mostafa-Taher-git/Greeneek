/** Contracts shared by the right-panel surface components. */
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import type { SidebarKey } from '../locales.ts'

/** One installed application reported by the Host. */
export interface DeviceAppEntry {
  /** Stable application id. */
  id: string
  /** Localized display name. */
  label: string
}

/** Host facts the Device surface displays. */
export interface DeviceFacts {
  /** Machine name, absent before the ready frame. */
  hostname: string | undefined
  /** Host home directory, absent before the ready frame. */
  home: string | undefined
  /** True when the Gateway is reached over loopback. */
  isLoopback: boolean
  /** Host platform token (`win32`, `darwin`, `linux`, ...). */
  platform: string
  /** Installed applications the Client can name. */
  apps: readonly DeviceAppEntry[]
}

/** One file-browser row, mirrored from the Host listing type. */
export interface FileRow {
  /** Base name. */
  name: string
  /** Fully qualified path. */
  path: string
  /** Directory or file. */
  kind: 'directory' | 'file'
  /** Dot-prefixed name. */
  hidden: boolean
}

/** One bounded directory level. */
export interface FileListing {
  /** Listed path. */
  path: string
  /** Host home. */
  home: string
  /** Ancestor rows. */
  crumbs: readonly FileRow[]
  /** Child rows. */
  entries: readonly FileRow[]
  /** True when the level was cut by the Host cap. */
  truncated: boolean
}

/** One bounded text read. */
export interface FileRead {
  /** Read path. */
  path: string
  /** UTF-8 text. */
  text: string
  /** True for binary files. */
  binary: boolean
  /** Byte length. */
  size: number
}

/** One changed file in the Diff surface. */
export interface DiffFile {
  /** Repository-relative path. */
  path: string
  /** Git status letters. */
  status: string
  /** Unified patch text. */
  patch: string
}

/** A unified change set from the Host. */
export interface DiffView {
  /** True when the path is in a git repository. */
  isRepository: boolean
  /** Base branch, when known. */
  baseBranch?: string
  /** Changed files. */
  files: readonly DiffFile[]
  /** True when the Host cut the diff by its byte cap. */
  truncated: boolean
}

/** Props of the Diff surface. */
export type DiffSurfaceProps = PropsLocale<'sidebar'> & {
  /** Workspace directory to diff. */
  cwd: string | undefined
  /** Load the unified diff through the Host Remote. */
  loadDiff: (path: string) => Promise<DiffView>
}

/** Props of the Files surface. */
export type FilesSurfaceProps = PropsLocale<'sidebar'> & {
  /** List one directory level through the Host Remote. */
  browseFiles: (path: string | undefined) => Promise<FileListing>
  /** Read one text file through the Host Remote. */
  readFile: (path: string) => Promise<FileRead>
}

/** Props of the Device surface. */
export type DeviceSurfaceProps = PropsLocale<'sidebar'> & {
  /** Load the Host facts through the plugin's injected Remote callbacks. */
  loadDevice: () => Promise<DeviceFacts>
}

/** Locale-key subset used by the surface components. */
export type SurfaceLocaleKey = SidebarKey
