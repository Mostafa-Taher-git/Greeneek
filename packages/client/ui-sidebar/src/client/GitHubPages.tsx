/** Standalone GitHub Branches and Issues pages backed by the Host GitHub Remote. */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import type { GithubBranchList, GithubIssueList } from '@greeneek/gnk-api-remotes/client'
import type {} from '@greeneek/gnk-client-ui-layout/client'
import css from './GitHubPages.module.css'
import type { GithubPagesLocaleKey } from './github-pages-locales.ts'

/** One page's injected face. */
export interface GithubPageInjected {
  /** Resolve the current workspace's GitHub repository. */
  repository: (path: string) => Promise<{ owner: string; repo: string }>
  /** Load branches. */
  branches: (request: { owner: string; repo: string }) => Promise<GithubBranchList>
  /** Load issues. */
  issues: (request: { owner: string; repo: string; page: number; perPage: number }) => Promise<GithubIssueList>
  /** Whether a token is configured. */
  configured: () => Promise<boolean>
  /** Current workspace directory. */
  cwd: () => string | undefined
  /** Return to the conversation. */
  close: () => void
  /** Open a URL in the user's browser. */
  openExternal: (url: string) => void
}

type Props =
  PropsRuntime<'branches' | 'issues'>
  & PropsLocale<'githubPages'>
  & GithubPageInjected

type Repo = { owner: string; repo: string }
type Translate = (key: GithubPagesLocaleKey) => string

/** Render one GitHub list page. */
function GithubPageView({ t, injected, kind, close }: {
  readonly t: Translate
  readonly injected: GithubPageInjected
  readonly kind: 'branches' | 'issues'
  readonly close: () => void
}) {
  const [repo, setRepo] = useState<Repo>()
  const [branches, setBranches] = useState<GithubBranchList>()
  const [issues, setIssues] = useState<GithubIssueList>()
  const [hint, setHint] = useState<GithubPagesLocaleKey>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setError(undefined)
    setHint(undefined)
    const path = injected.cwd()
    if (path === undefined) { setHint('noWorkspace'); return }
    if (!await injected.configured()) { setHint('unconfigured'); return }
    try {
      const resolved = await injected.repository(path)
      setRepo(resolved)
      if (kind === 'branches') setBranches(await injected.branches(resolved))
      else setIssues(await injected.issues({ ...resolved, page: 1, perPage: 50 }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [injected, kind])

  useEffect(() => { void load() }, [load])

  return (
    <div className={css.root}>
      <header className={css.header}>
        <h2 className={css.title}>{t(kind === 'branches' ? 'branches' : 'issues')}</h2>
        <div className={css.actions}>
          <button type="button" onClick={() => { void load() }}>{t('retry')}</button>
          <button type="button" aria-label={t('close')} onClick={close}>✕</button>
        </div>
      </header>
      {repo !== undefined && <p className={css.repo}>{repo.owner}/{repo.repo}</p>}
      {hint !== undefined && <p className={css.notice}>{t(hint)}</p>}
      {error !== undefined && <p className={css.notice}>{t('loadFailed')} {error}</p>}
      {kind === 'branches' && (branches?.items.length ?? 0) === 0 && hint === undefined && error === undefined
        && <p className={css.notice}>{t('emptyBranches')}</p>}
      {kind === 'issues' && (issues?.items.length ?? 0) === 0 && hint === undefined && error === undefined
        && <p className={css.notice}>{t('emptyIssues')}</p>}
      <div className={css.list}>
        {kind === 'branches' && branches?.items.map(branch => (
          <div key={branch.name} className={css.row}>
            <span className={css.rowName}>{branch.name}</span>
            {branch.protected && <span className={css.badge}>{t('protected')}</span>}
            <code className={css.sha}>{branch.sha.slice(0, 8)}</code>
          </div>
        ))}
        {kind === 'issues' && issues?.items.map(issue => (
          <div key={issue.number} className={css.row}>
            <button type="button" className={css.rowName} onClick={() => { injected.openExternal(issue.htmlUrl) }}>
              #{issue.number} {issue.title}
            </button>
            <span className={css.badge}>{issue.state}</span>
            <button type="button" className={css.link} onClick={() => { injected.openExternal(issue.htmlUrl) }}>{t('openOnGitHub')}</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** GitHub Branches standalone page. */
export function BranchesPage(props: Props) {
  return <GithubPageView kind="branches" t={props.t} injected={props} close={props.close} />
}

/** GitHub Issues standalone page. */
export function IssuesPage(props: Props) {
  return <GithubPageView kind="issues" t={props.t} injected={props} close={props.close} />
}
