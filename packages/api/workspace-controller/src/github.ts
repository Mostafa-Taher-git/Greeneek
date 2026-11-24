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
  GithubBranchList, GithubCheck, GithubComment, GithubIssueList,
  GithubPullFile, GithubPullRequest, GithubPullRequestActionRequest,
  GithubPullRequestActionResult, GithubPullRequestDetail, GithubPullRequestDetailRequest,
  GithubPullRequestList, GithubPullRequestRequest, GithubRepository, GithubStatus,
} from './types.ts'

/** Credential the integration reads from the user's own configuration. */
export const GITHUB_TOKEN_REF = 'GITHUB_TOKEN' as import('@greeneek/gnk-credentials/types').CredentialRef

/** Maximum page size the Host grants. */
export const GITHUB_PAGE_LIMIT = 100
/** Unicode-character cap for a PR body or comment. */
export const GITHUB_TEXT_LIMIT = 16_384
/** Maximum number of files, checks and comments retained per detail read. */
export const GITHUB_DETAIL_ITEMS = 100

/** One HTTP request option set for an authenticated GitHub call. */
export interface GithubFetchOptions {
  /** HTTP method; GET when absent. */
  method?: string
  /** JSON request body. */
  body?: string
}

/** Injectable HTTP and credential seams for deterministic tests. */
export interface GithubInternals {
  /** Perform one authenticated GitHub request. */
  fetch: (
    url: string,
    token: string | undefined,
    signal: AbortSignal,
    options?: GithubFetchOptions,
  ) => Promise<unknown>
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

/** Test seams keyed by Host context; never read from the inject proxy. */
const internalsByContext = new WeakMap<Context, GithubInternals>()

/**
 * Install scripted credential/network primitives for one Host context (tests only).
 * @param ctx - Host context whose controller reads the seam.
 * @param io - scripted primitives to substitute.
 */
export function setGithubInternals(ctx: Context, io: GithubInternals): void {
  internalsByContext.set(ctx, io)
}

/** Host service backing the generated `ctx.remote.github` namespace. */
export class GithubController extends TypertRemoteService {
  static inject = ['credentials']

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'githubController', { namespace: 'github' })
  }

  /** Resolve the test seams, defaulting to the user credential and Host fetch. */
  private get io(): GithubInternals {
    return internalsByContext.get(this.ctx) ?? {
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
   * List branches for one repository.
   * @param request - repository owner and name.
   * @param signal - caller lifetime.
   * @returns the repository's branches, capped at the page limit.
   */
  @Remote('branches')
  async branches(request: GithubPullRequestRequest, signal: AbortSignal): Promise<GithubBranchList> {
    validate(request)
    const token = await this.io.token()
    if (token === undefined || token === '') {
      throw new RemoteError('github/unconfigured', 'no GitHub token is configured', {})
    }
    const query = new URLSearchParams({ per_page: String(GITHUB_PAGE_LIMIT) })
    const url = `https://api.github.com/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/branches?${query}`
    const payload = await this.io.fetch(url, token, signal)
    const rows = Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []
    return {
      items: rows.slice(0, GITHUB_PAGE_LIMIT).map(row => ({
        name: bound(typeof row.name === 'string' ? row.name : ''),
        sha: bound(typeof row.commit === 'object' && row.commit !== null && typeof (row.commit as Record<string, unknown>).sha === 'string' ? (row.commit as Record<string, unknown>).sha as string : ''),
        protected: row.protected === true,
      })),
    }
  }

  /**
   * List issues for one repository with explicit pagination.
   * @param request - repository owner, name, state and pagination.
   * @param signal - caller lifetime.
   * @returns one bounded page of issues and whether another page exists.
   */
  @Remote('issues')
  async issues(request: GithubPullRequestRequest, signal: AbortSignal): Promise<GithubIssueList> {
    validate(request)
    const repo = `repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}`
    const { payload, perPage } = await this.requestPage(request, signal, `${repo}/issues`, (page, perPage) => ({
      state: request.state ?? 'open', page: String(page), per_page: String(perPage),
    }))
    const rows = Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []
    return {
      items: rows.slice(0, perPage).map(row => ({
        number: typeof row.number === 'number' ? row.number : 0,
        title: bound(typeof row.title === 'string' ? row.title : ''),
        state: bound(typeof row.state === 'string' ? row.state : ''),
        htmlUrl: bound(typeof row.html_url === 'string' ? row.html_url : ''),
        updatedAt: bound(typeof row.updated_at === 'string' ? row.updated_at : ''),
      })),
      hasNext: rows.length >= perPage,
    }
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
    const repo = `repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}`
    const { payload, page, perPage } = await this.requestPage(request, signal, `${repo}/pulls`, (page, perPage) => ({
      state: request.state ?? 'open', page: String(page), per_page: String(perPage),
    }))
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
    // Honour the caller's pagination like the repository PR list: a page of 30
    // must not return the full 100-item search ceiling.
    const { payload, page, perPage } = await this.requestPage(request, signal, 'search/issues', (page, perPage) => ({
      q: `is:pr repo:${request.owner}/${request.repo} head:${request.branch}`,
      page: String(page), per_page: String(perPage),
    }))
    return present(payload, perPage, page)
  }

  /**
   * Read one PR's detail, files, head checks and comments in bounded parallel reads.
   * @param request - owner, repo and PR number.
   * @param signal - caller lifetime.
   * @returns the bounded detail projection.
   */
  @Remote('pullRequestDetail')
  async pullRequestDetail(
    request: GithubPullRequestDetailRequest,
    signal: AbortSignal,
  ): Promise<GithubPullRequestDetail> {
    validateDetail(request)
    const token = await this.requireToken()
    const base = `https://api.github.com/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}`
    const query = `per_page=${GITHUB_DETAIL_ITEMS}&page=1`
    const pull = await this.io.fetch(`${base}/pulls/${request.number}`, token, signal)
    const api = pull as GithubApiPull & {
      body?: string
      merged?: boolean
      base?: { ref?: string }
      head?: { ref?: string; sha?: string }
    }
    const sha = api.head?.sha ?? ''
    const [files, checks, comments] = await Promise.all([
      this.io.fetch(`${base}/pulls/${request.number}/files?${query}`, token, signal),
      sha === ''
        ? Promise.resolve([])
        : this.io.fetch(
          `${base}/commits/${encodeURIComponent(sha)}/check-runs?${query}`, token, signal,
        ),
      this.io.fetch(`${base}/issues/${request.number}/comments?${query}`, token, signal),
    ])

    return {
      number: api.number,
      title: bound(api.title),
      body: bound(api.body ?? ''),
      state: api.state,
      merged: api.merged ?? false,
      draft: api.draft ?? false,
      branch: api.head?.ref ?? '',
      baseBranch: api.base?.ref ?? '',
      author: api.user?.login ?? '',
      url: api.html_url,
      files: projectFiles(files),
      checks: projectChecks(checks),
      comments: projectComments(comments),
    }
  }

  /**
   * Perform a supported PR action on GitHub.
   * @param request - owner, repo, PR number and action.
   * @param signal - caller lifetime.
   * @returns the accepted outcome.
   */
  @Remote('pullRequestAction')
  async pullRequestAction(
    request: GithubPullRequestActionRequest,
    signal: AbortSignal,
  ): Promise<GithubPullRequestActionResult> {
    validateDetail(request)
    const action: string = request.action
    if (action !== 'merge' && action !== 'close') {
      throw new RemoteError('gateway/bad-request', 'unsupported PR action', {})
    }
    const token = await this.requireToken()
    const url = `https://api.github.com/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/pulls/${request.number}`
    const options: GithubFetchOptions = request.action === 'merge'
      ? { method: 'PUT', body: JSON.stringify({ merge_method: 'merge' }) }
      : { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) }
    try {
      const result = await this.io.fetch(url, token, signal, options) as { merged?: boolean; state?: string }
      return {
        done: request.action === 'merge' ? result.merged === true : result.state === 'closed',
        message: request.action === 'merge' ? 'merged' : 'closed',
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
      const status = error instanceof RemoteError
        ? (error.details as { status?: number }).status ?? 0
        : 0
      throw new RemoteError('github/action-failed', errorMessage(error), { status }, { cause: error })
    }
  }

  /**
   * Fetch one bounded GitHub page with the caller's token and paging.
   * @param request - repository owner, name and pagination.
   * @param signal - caller lifetime.
   * @param path - REST path below `https://api.github.com/`.
   * @param query - page/perPage-dependent query parameters.
   * @returns the payload, requested page and effective page size.
   */
  private async requestPage(
    request: GithubPullRequestRequest,
    signal: AbortSignal,
    path: string,
    query: (page: number, perPage: number) => Record<string, string>,
  ): Promise<{ payload: unknown; page: number; perPage: number }> {
    const token = await this.requireToken()
    const page = request.page ?? 1
    const perPage = Math.min(request.perPage ?? 30, GITHUB_PAGE_LIMIT)
    const url = `https://api.github.com/${path}?${new URLSearchParams(query(page, perPage))}`
    const payload = await this.io.fetch(url, token, signal)
    return { payload, page, perPage }
  }

  /** Resolve the user token or refuse the call. */
  private async requireToken(): Promise<string> {
    const token = await this.io.token()
    if (token === undefined || token === '') {
      throw new RemoteError('github/unconfigured', 'no GitHub token is configured', {})
    }
    return token
  }
}

/** Validate a PR-addressing request before any network call. */
function validateDetail(request: { owner: string; repo: string; number: number }): void {
  if (request.owner.trim() === '' || request.repo.trim() === '' || !Number.isInteger(request.number) || request.number <= 0) {
    throw new RemoteError('gateway/bad-request', 'a repository owner, name and PR number are required', {})
  }
}

/** Bound a Host string before it reaches the browser. */
function bound(value: string): string {
  return value.slice(0, GITHUB_TEXT_LIMIT)
}

/** Project a bounded list of changed files. */
function projectFiles(payload: unknown): GithubPullFile[] {
  const rows = Array.isArray(payload) ? payload.slice(0, GITHUB_DETAIL_ITEMS) : []
  return rows.map((row) => {
    const item = row as { filename?: string; status?: string; additions?: number; deletions?: number }
    return {
      path: bound(item.filename ?? ''),
      status: item.status ?? 'modified',
      additions: item.additions ?? 0,
      deletions: item.deletions ?? 0,
    }
  })
}

/** Project a bounded list of check runs. */
function projectChecks(payload: unknown): GithubCheck[] {
  const rows = (payload as { check_runs?: unknown } | undefined)?.check_runs
  const list = Array.isArray(rows) ? rows.slice(0, GITHUB_DETAIL_ITEMS) : []
  return list.map((row) => {
    const item = row as { name?: string; conclusion?: string | null }
    return { name: bound(item.name ?? ''), conclusion: item.conclusion ?? 'pending' }
  })
}

/** Project a bounded list of issue comments. */
function projectComments(payload: unknown): GithubComment[] {
  const rows = Array.isArray(payload) ? payload.slice(0, GITHUB_DETAIL_ITEMS) : []
  return rows.map((row) => {
    const item = row as { body?: string; created_at?: string; user?: { login?: string } }
    return {
      author: item.user?.login ?? '',
      body: bound(item.body ?? ''),
      createdAt: item.created_at ?? '',
    }
  })
}

/** Safe message for a failed GitHub call. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
async function hostFetch(
  url: string,
  token: string | undefined,
  signal: AbortSignal,
  options: GithubFetchOptions = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token ?? ''}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
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
