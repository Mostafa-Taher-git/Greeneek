import { Context } from '@greeneek/cordis'
import AgentRegistry from '@greeneek/gnk-agent'
import SessionStore from '@greeneek/gnk-session'
import { describe, expect, it, vi } from 'vitest'
import type { SessionExternalAppsValue } from '../src/types.ts'
import { createSessionTestRemote } from './test-remote.ts'

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return ctx
}

/** A catalogue with one installed application and one absent application. */
function catalogue(overrides: Partial<SessionExternalAppsValue> = {}): SessionExternalAppsValue {
  return {
    platform: 'linux',
    apps: [{ id: 'cursor', available: true }, { id: 'vscode', available: false }],
    canReveal: true,
    ...overrides,
  }
}

describe('session/externalApps', () => {
  it('reports the host catalogue, platform, and reveal capability', async () => {
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      externalApps: () => catalogue(),
    })

    await expect(remote.externalApps()).resolves.toEqual({
      ok: true,
      value: catalogue(),
    })
  })

  it('probes the real catalogue when the host supplies no override', async () => {
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
    })

    const result = await remote.externalApps()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.apps.map(app => app.id)).toEqual([
      'cursor',
      'vscode',
      'android-studio',
      'github-desktop',
    ])
    expect(typeof result.value.canReveal).toBe('boolean')
  })
})

describe('session/openPath', () => {
  it('hands the path to the default application', async () => {
    const openPath = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      openPath,
    })

    await expect(remote.openPath({ path: '/projects/app', target: { kind: 'default' } }))
      .resolves.toEqual({ ok: true, value: { opened: true } })
    expect(openPath).toHaveBeenCalledWith('/projects/app', expect.any(AbortSignal))
  })

  it('reveals the path in the system file manager', async () => {
    const revealPath = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      revealPath,
      canRevealPath: () => true,
      externalApps: () => catalogue(),
    })

    await expect(remote.openPath({ path: '/projects/app', target: { kind: 'reveal' } }))
      .resolves.toEqual({ ok: true, value: { opened: true } })
    expect(revealPath).toHaveBeenCalledWith('/projects/app', expect.any(AbortSignal))
  })

  it('refuses a reveal on a host without a file manager', async () => {
    const revealPath = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      revealPath,
      canRevealPath: () => false,
      externalApps: () => catalogue({ canReveal: false }),
    })

    await expect(remote.openPath({ path: '/projects/app', target: { kind: 'reveal' } }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/path-reveal-unsupported' },
      })
    expect(revealPath).not.toHaveBeenCalled()
  })

  it('launches an installed external application', async () => {
    const launchApp = vi.fn((_appId: string, _path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      launchApp,
      externalApps: () => catalogue(),
    })

    await expect(remote.openPath({ path: '/projects/app', target: { kind: 'app', appId: 'cursor' } }))
      .resolves.toEqual({ ok: true, value: { opened: true } })
    expect(launchApp).toHaveBeenCalledWith('cursor', '/projects/app', expect.any(AbortSignal))
  })

  it('refuses an application the host does not have installed', async () => {
    const launchApp = vi.fn((_appId: string, _path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      launchApp,
      externalApps: () => catalogue(),
    })

    await expect(remote.openPath({ path: '/projects/app', target: { kind: 'app', appId: 'vscode' } }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/path-app-unavailable' },
      })
    expect(launchApp).not.toHaveBeenCalled()
  })

  it('rejects an empty path before touching the desktop', async () => {
    const openPath = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      openPath,
    })

    await expect(remote.openPath({ path: '', target: { kind: 'default' } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('rejects a target kind this build does not know', async () => {
    const openPath = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      openPath,
    })

    await expect(remote.openPath({
      path: '/projects/app',
      target: { kind: 'printer' } as unknown as { kind: 'default' },
    })).resolves.toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports a cancelled request as cancelled', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('gateway/cancelled'))
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
    })

    await expect(remote.openPath({ path: '/projects/app', target: { kind: 'default' } }, aborted.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
  })
})

describe('session/gitFacts', () => {
  it('reports the git facts of a project directory', async () => {
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
      gitFacts: async () => ({
        isRepository: true,
        branch: 'main',
        baseBranch: 'main',
        changedFiles: 3,
        insertions: 120,
        deletions: 4,
      }),
    })

    await expect(remote.gitFacts({ path: '/projects/app' })).resolves.toEqual({
      ok: true,
      value: {
        isRepository: true,
        branch: 'main',
        baseBranch: 'main',
        changedFiles: 3,
        insertions: 120,
        deletions: 4,
      },
    })
  })

  it('rejects an empty project path', async () => {
    const remote = createSessionTestRemote(await context(), {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/default',
    })

    await expect(remote.gitFacts({ path: '' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
  })
})
