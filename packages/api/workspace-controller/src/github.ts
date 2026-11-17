/**
 * GitHub pull-request Remotes. The Host resolves a user-owned credential from
 * `ctx.credentials`, calls the public GitHub REST API from the Host process,
 * and returns only plain PR summaries to the browser. Token values never cross
 * the Remote boundary; redirects are refused so a token cannot be replayed at
 * another origin.
 */
import { Context } from '@greeneek/cordis'
// Type-only: pulls the ctx.credentials service merge.
import type {} from '@greeneek/gnk-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@greeneek/gnk-typert-protocol'
import { runNativeCommand, type NativeCommandRunner } from '@greeneek/gnk-native-command'
import type {
  GithubPullRequest, GithubPullRequestList, GithubPullRequestRequest, GithubRepository, GithubStatus,
} from './types.ts'

/** Credential the integration reads from the user's own configuration. */
export const GITHUB_TOKEN_REF = 'GITHUB_TOKEN' as import('@greeneek/gnk-credentials/types').CredentialRef

/** Maximum page size the Host grants. */
export const GITHUB_PAGE_LIMIT = 100

/** Injectable HTTP and credential seams for deterministic tests. */
export interface GithubInternals {
  /** Perform one GET request with an Authorization header. */
  fetch: (url: string, token: string | undefined, signal: AbortSignal) => Promise<unknown>
  /** Resolve the current user token; undefined when unconfigured. */
  token: () => Promise<string | undefined>
  /** Read-only command runner for the workspace git remote. */
  run: NativeCommandRunner
}

/** Minimal PR shape returned by the GitHub REST API. */
interface GithubApiPull {
  number: number
  title: string
  state: string
  html_url: string
  draft?: boolean
  user?: { login?: string }
  head?: { ref?: string }
  base?: { ref?: string }
  updated_at?: string
}

/**
 * Host service backing the generated `ctx.remote.github` namespace.
 * @param ctx - Host context carrying the credentials service.
 */
export class GithubController extends TypertRemoteService {
  static inject = ['credentials']

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'githubController', { namespace: 'github' })
  }

  /** Resolve the test seams, defaulting to the user credential and Host fetch. */
  private get io(): GithubInternals {
    return (this.ctx as Context & { githubInternals?: GithubInternals }).githubInternals ?? {
      fetch: hostFetch,
      run: runNativeCommand,
      token: async () => {
        const resolved = await this.ctx.credentials.resolve(GITHUB_TOKEN_REF)
        return resolved?.value
      },
    }
  }

  /**
   * Derive the GitHub repository identity from a workspace's origin remote.
   * @param request - workspace directory.
   * @param signal - caller lifetime.
   * @returns owner and repository name.
   */
  @Remote('repository')
  async repository(request: { path: string }, signal: AbortSignal): Promise<GithubRepository> {
    if (request.path.length === 0) {
      throw new RemoteError('gateway/bad-request', 'github.repository requires a path', {})
    }
    try {
      const { stdout } = await this.io.run('git', ['-C', request.path, 'remote', 'get-url', 'origin'], signal)
      const parsed = parseRepository(stdout.trim())
      if (parsed === undefined) throw new Error('not a GitHub remote')
      return parsed
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw new RemoteError('github/no-remote', `no GitHub remote in ${request.path}`, { path: request.path }, { cause: error })
    }
  }

  /**
   * Report whether a user token is configured. No secret value is returned.
   * @returns the configuration state.
   */
  @Remote('status')
  async status(): Promise<GithubStatus> {
    const token = await this.io.token()
    return { configured: token !== undefined && token !== '', pageLimit: GITHUB_PAGE_LIMIT }
  }

  /**
   * List pull requests for one repository with explicit pagination.
   * @param request - owner, repo, state, page and page size.
   * @param signal - caller lifetime.
   * @returns one bounded page and whether another page exists.
   */
  @Remote('pullRequests')
  async pullRequests(request: GithubPullRequestRequest, signal: AbortSignal): Promise<GithubPullRequestList> {
    validate(request)
    const token = await this.io.token()
    if (token === undefined || token === '') {
      throw new RemoteError('github/unconfigured', 'no GitHub token is configured', {})
    }
    const page = request.page ?? 1
    const perPage = Math.min(request.perPage ?? 30, GITHUB_PAGE_LIMIT)
    const query = new URLSearchParams({
      state: request.state ?? 'open',
      page: String(page),
      per_page: String(perPage),
    })
    const url = `https://api.github.com/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/pulls?${query}`
    const payload = await this.io.fetch(url, token, signal)
    return present(payload, perPage, page)
  }

  /**
   * List pull requests linked to one branch, used by the Linked PRs surface.
   * @param request - owner, repo and head branch.
   * @param signal - caller lifetime.
   * @returns matching pull requests.
   */
  @Remote('linkedPullRequests')
  async linkedPullRequests(request: GithubPullRequestRequest, signal: AbortSignal): Promise<GithubPullRequestList> {
    validate(request)
    if (request.branch === undefined || request.branch === '') {
      throw new RemoteError('gateway/bad-request', 'github.linkedPullRequests requires a branch', {})
    }
    const token = await this.io.token()
    if (token === undefined || token === '') {
      throw new RemoteError('github/unconfigured', 'no GitHub token is configured', {})
    }
    const query = new URLSearchParams({
      q: `is:pr repo:${request.owner}/${request.repo} head:${request.branch}`,
      per_page: String(GITHUB_PAGE_LIMIT),
    })
    const payload = await this.io.fetch(`https://api.github.com/search/issues?${query}`, token, signal)
    return present(payload, GITHUB_PAGE_LIMIT, 1)
  }
}

/** Parse `owner/repo` from an HTTPS or SSH GitHub remote URL. */
function parseRepository(url: string): GithubRepository | undefined {
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url)
  if (https?.[1] !== undefined && https[2] !== undefined) return { owner: https[1], repo: https[2] }
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url)
  if (ssh?.[1] !== undefined && ssh[2] !== undefined) return { owner: ssh[1], repo: ssh[2] }
  return undefined
}

/** Validate the wire request before any network call. */
function validate(request: GithubPullRequestRequest): void {
  if (request.owner.trim() === '' || request.repo.trim() === '') {
    throw new RemoteError('gateway/bad-request', 'a repository owner and name are required', {})
  }
}

/** Default Host fetch: refuses redirects and non-OK responses. */
async function hostFetch(url: string, token: string | undefined, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token ?? ''}`,
    },
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    throw new RemoteError('github/failed', `GitHub answered ${response.status}`, { status: response.status })
  }
  return await response.json()
}

/** Project an API payload into the wire-safe PR list. */
function present(payload: unknown, perPage: number, page: number): GithubPullRequestList {
  const raw = payload as { items?: unknown; total_count?: number } | readonly unknown[] | undefined
  const object: { items?: unknown; total_count?: number } | undefined = Array.isArray(raw)
    ? undefined
    : raw as { items?: unknown; total_count?: number }
  const rows = (Array.isArray(raw) ? raw : Array.isArray(object?.items) ? object.items : []) as GithubApiPull[]
  const items: GithubPullRequest[] = rows.map(row => ({
    number: row.number,
    title: row.title,
    state: row.state,
    url: row.html_url,
    branch: row.head?.ref ?? '',
    author: row.user?.login ?? '',
    draft: row.draft ?? false,
    updatedAt: row.updated_at ?? '',
  }))
  const total = object !== undefined && typeof object.total_count === 'number' ? object.total_count : undefined
  return {
    items,
    hasNext: total === undefined ? items.length === perPage : page * perPage < total,
  }
}
