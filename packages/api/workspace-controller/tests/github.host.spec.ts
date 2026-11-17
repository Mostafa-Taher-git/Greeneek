import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@greeneek/cordis'
import { GithubController, GITHUB_PAGE_LIMIT, setGithubInternals } from '../src/github.ts'
import type { GithubInternals } from '../src/github.ts'

const signal = new AbortController().signal
const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Build a controller with scripted credential and network seams. */
async function harness(io: Partial<GithubInternals> = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const controller = new GithubController(ctx)
  setGithubInternals(ctx, {
    token: io.token ?? (async () => 'user-token'),
    fetch: io.fetch ?? (async () => []),
    run: io.run ?? (async () => ({ stdout: '', stderr: '' })),
  })
  return controller
}

/** One PR row returned by the API. */
const row = {
  number: 7,
  title: 'Fix the thing',
  state: 'open',
  html_url: 'https://github.com/o/r/pull/7',
  head: { ref: 'feature' },
  user: { login: 'alice' },
  draft: false,
  updated_at: '2026-11-17T00:00:00Z',
}

describe('GithubController', () => {
  it('reports configuration without returning a token', async () => {
    const controller = await harness()
    await expect(controller.status()).resolves.toEqual({
      configured: true, pageLimit: GITHUB_PAGE_LIMIT,
    })
  })

  it('derives the repository from an HTTPS origin remote', async () => {
    const controller = await harness({
      run: async () => ({ stdout: 'https://github.com/o/r.git\n', stderr: '' }),
    })
    await expect(controller.repository({ path: '/workspace/app' }, signal)).resolves.toEqual({
      owner: 'o', repo: 'r',
    })
  })

  it('lists one page and caps the requested size', async () => {
    const fetch = vi.fn(async (_url: string, _token: string | undefined, _signal: AbortSignal) => [row])
    const controller = await harness({ fetch })
    const result = await controller.pullRequests({
      owner: 'o', repo: 'r', perPage: 1000, page: 2,
    }, signal)
    expect(result.items).toMatchObject([{ number: 7, branch: 'feature', author: 'alice' }])
    expect(fetch.mock.calls[0]?.[0]).toContain('per_page=100')
    expect(fetch.mock.calls[0]?.[0]).toContain('page=2')
  })

  it('refuses an unconfigured integration', async () => {
    const controller = await harness({ token: async () => undefined })
    await expect(controller.pullRequests({ owner: 'o', repo: 'r' }, signal)).rejects.toMatchObject({
      code: 'github/unconfigured',
    })
  })

  it('uses the search endpoint for linked pull requests', async () => {
    const fetch = vi.fn(async (_url: string, _token: string | undefined, _signal: AbortSignal) => ({
      items: [row], total_count: 1,
    }))
    const controller = await harness({ fetch })
    const result = await controller.linkedPullRequests({
      owner: 'o', repo: 'r', branch: 'feature',
    }, signal)
    expect(fetch.mock.calls[0]?.[0]).toContain('search/issues')
    expect(fetch.mock.calls[0]?.[0]).toContain('head%3Afeature')
    expect(result.hasNext).toBe(false)
  })

  it('reports a following page from a search total', async () => {
    const controller = await harness({
      fetch: async () => ({ items: [row], total_count: 500 }),
    })
    const result = await controller.linkedPullRequests({ owner: 'o', repo: 'r', branch: 'b' }, signal)
    expect(result.hasNext).toBe(true)
  })

  it('refuses a request without a repository', async () => {
    const controller = await harness()
    await expect(controller.pullRequests({ owner: '', repo: 'r' }, signal)).rejects.toMatchObject({
      code: 'gateway/bad-request',
    })
  })
})
