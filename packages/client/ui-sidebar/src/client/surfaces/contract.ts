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

/** One GitHub PR row shown by the two PR surfaces. */
export interface PullRequestRow {
  /** PR number. */
  number: number
  /** Title. */
  title: string
  /** GitHub state. */
  state: string
  /** PR web URL, shown as data. */
  url: string
  /** Head branch. */
  branch: string
  /** Author login. */
  author: string
  /** Draft flag. */
  draft: boolean
  /** Last update timestamp. */
  updatedAt: string
}

/** One page of PR rows. */
export interface PullRequestPage {
  /** Rows in GitHub order. */
  items: readonly PullRequestRow[]
  /** True when another page exists. */
  hasNext: boolean
}

/** Request for one page of GitHub pull requests. */
export interface PullRequestRequest {
  /** Repository owner. */
  owner: string
  /** Repository name. */
  repo: string
  /** Head branch for a linked lookup. */
  branch?: string
  /** One-based page. */
  page: number
  /** Requested page size. */
  perPage: number
}

/** Configuration state of the GitHub integration. */
export interface GithubStatus {
  /** True when the user configured a token. */
  configured: boolean
  /** Maximum Host page size. */
  pageLimit: number
}

/** Props of the GitHub PR surfaces. */
export type PullRequestsSurfaceProps = PropsLocale<'sidebar'> & {
  /** Workspace path. */
  cwd: string | undefined
  /** True when a user token is configured. */
  configured: boolean
  /** Load one PR page. */
  load: (request: PullRequestRequest) => Promise<PullRequestPage>
  /** Resolve owner/repo from the workspace remote. */
  repository: (path: string) => Promise<{ owner: string; repo: string }>
  /** Resolve the current branch, used by Linked pull requests. */
  branch: (path: string) => Promise<string | undefined>
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
