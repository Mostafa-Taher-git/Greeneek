/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@greeneek/gnk-session/types'
import type { WorkspaceId } from '@greeneek/gnk-workspace/types'

export type { WorkspaceId } from '@greeneek/gnk-workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@greeneek/gnk-host-directory-picker/types'

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /** Canonical host directory path. */
  readonly path: string
  /** User-visible title. */
  readonly title: string
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

declare module '@greeneek/gnk-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested directory cannot back a Workspace. */
    'workspace/invalid-path': { readonly path: string }
    /** Another Workspace already uses the requested name. */
    'workspace/name-conflict': { readonly name: string }
    /** The Session or its anchor is not in the Workspace's manual order. */
    'workspace/move-invalid': {
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
      readonly beforeSessionId?: SessionId
    }
    /** The verb needs an interaction the composed backend does not serve. */
    'directory-picker/unavailable': { readonly capability: string }
    /** The target is not fully qualified, or the backend cannot list it. */
    'directory-picker/unreadable': { readonly path: string }
    /** A child of that name is already there. */
    'directory-picker/exists': { readonly path: string }
    /** The parent is not fully qualified, the name is not one segment, or creation failed. */
    'directory-picker/create-failed': { readonly path: string }
    /** The requested directory or file cannot be read. */
    'files/unreadable': { readonly path: string }
    /** The file exceeds the Host read cap. */
    'files/too-large': { readonly path: string }
    /** A git push was refused or failed. */
    'files/push-failed': { readonly path: string }
    /** No user-owned GitHub token is configured. */
    'github/unconfigured': {}
    /** GitHub refused the request. */
    'github/failed': { readonly status: number }
    /** No GitHub remote is configured in the workspace. */
    'github/no-remote': { readonly path: string }
  }
}

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Session requested for permanent deletion with its stored log. */
export interface WorkspaceDeleteSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Complete archived Session set after a session deletion (the id is unarchived). */
export interface WorkspaceDeleteSessionValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Session requested for a pin-state change. */
export interface WorkspacePinSessionRequest {
  readonly sessionId: SessionId
  /** The requested pin state. */
  readonly pinned: boolean
}

/** Complete pinned Session set after a mutation. */
export interface WorkspacePinSessionValue {
  readonly pinnedSessionIds: readonly SessionId[]
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
  /**
   * Registry-global pin set. A Host that predates the pin set omits the
   * field, which the Client reads as an empty set.
   */
  readonly pinnedSessionIds?: readonly SessionId[]
}

/** One ordered Workspace change after a generation's baseline. */
export type WorkspaceFollowIncrement =
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }
  | { readonly type: 'pinned'; readonly pinnedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement

/** One row of a Host file-browser listing. */
export interface FileBrowserEntry {
  /** Base name within the listed level. */
  readonly name: string
  /** Fully qualified path of the row. */
  readonly path: string
  /** Whether the row can be entered as a directory. */
  readonly kind: 'directory' | 'file'
  /** True for dot-prefixed names. */
  readonly hidden: boolean
}

/** One bounded directory level for the Files surface. */
export interface FileBrowserListing {
  /** Fully qualified path that was listed. */
  readonly path: string
  /** Host home directory. */
  readonly home: string
  /** Ancestor chain from the filesystem root to path. */
  readonly crumbs: readonly FileBrowserEntry[]
  /** Name-sorted rows, bounded by the Host cap. */
  readonly entries: readonly FileBrowserEntry[]
  /** True when the level had more rows than the cap. */
  readonly truncated: boolean
}

/** One bounded text read for the Files surface. */
export interface FileBrowserRead {
  /** Fully qualified path that was read. */
  readonly path: string
  /** UTF-8 text; empty for a binary file. */
  readonly text: string
  /** True when the file contains NUL bytes. */
  readonly binary: boolean
  /** Byte length of the file. */
  readonly size: number
}

/** Repository identity derived from a git remote. */
export interface GithubRepository {
  /** Owner namespace. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
}

/** Configuration state of the GitHub integration, without secret values. */
export interface GithubStatus {
  /** True when a user-owned token is configured. */
  readonly configured: boolean
  /** Maximum page size the Host grants. */
  readonly pageLimit: number
}

/** One GitHub pull request summary. */
export interface GithubPullRequest {
  /** Repository-local PR number. */
  readonly number: number
  /** PR title. */
  readonly title: string
  /** GitHub state (`open`, `closed`, ...). */
  readonly state: string
  /** Web URL of the PR, displayed as data rather than navigated in-app. */
  readonly url: string
  /** Head branch. */
  readonly branch: string
  /** Author login. */
  readonly author: string
  /** True for a draft PR. */
  readonly draft: boolean
  /** Last update timestamp from GitHub. */
  readonly updatedAt: string
}

/** Request for one page of GitHub pull requests. */
export interface GithubPullRequestRequest {
  /** Repository owner. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
  /** Head branch for the linked-PR lookup. */
  readonly branch?: string
  /** GitHub state filter. */
  readonly state?: string
  /** One-based page number. */
  readonly page?: number
  /** Requested page size, capped by the Host. */
  readonly perPage?: number
}

/** One bounded page of PR summaries. */
export interface GithubPullRequestList {
  /** PR rows in GitHub order. */
  readonly items: readonly GithubPullRequest[]
  /** True when another page exists. */
  readonly hasNext: boolean
}
