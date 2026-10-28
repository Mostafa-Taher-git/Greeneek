import { describe, expect, it } from 'vitest'
import { decideDeployment, landingChangeReasons } from '../vercel-ignore.mjs'

/**
 * The landing deployment skip decision: build when the landing project or its
 * dependency inputs changed, skip clearly unrelated changes, and fail open on
 * missing facts so an undecidable event never skips a needed deploy.
 */

describe('vercel-ignore', () => {
  it('builds when a landing file changed, in either checkout layout', () => {
    expect(decideDeployment({ previousSha: 'base', changedPaths: ['apps/landing/src/App.tsx'] }).skip).toBe(false)
    expect(decideDeployment({ previousSha: 'base', changedPaths: ['landing/src/App.tsx'] }).skip).toBe(false)
    expect(landingChangeReasons(['apps/landing/index.html'])).toEqual(['a landing source file changed'])
  })

  it('builds when the lockfile or a root workspace file changed', () => {
    expect(decideDeployment({ previousSha: 'base', changedPaths: ['pnpm-lock.yaml'] }).skip).toBe(false)
    expect(decideDeployment({ previousSha: 'base', changedPaths: ['packages/core/session/src/index.ts', 'package.json'] }).skip).toBe(false)
  })

  it('skips a clearly unrelated change', () => {
    const decision = decideDeployment({ previousSha: 'base', changedPaths: ['python/sdk/src/greeneek/client.py', 'packages/llm/llm-greeneek/src/provider.ts'] })
    expect(decision.skip).toBe(true)
    expect(decision.reason).toContain('no change touches the landing project')
  })

  it('builds when the previous SHA is missing or the diff is unavailable', () => {
    expect(decideDeployment({ previousSha: undefined, changedPaths: ['unrelated.txt'] }).skip).toBe(false)
    expect(decideDeployment({ previousSha: '', changedPaths: [] }).skip).toBe(false)
    expect(decideDeployment({ previousSha: 'base', changedPaths: undefined }).skip).toBe(false)
  })

  it('collapses many landing files and dependency inputs into distinct reasons', () => {
    const reasons = landingChangeReasons(['apps/landing/src/a.tsx', 'apps/landing/src/b.tsx', 'pnpm-lock.yaml'])
    expect(reasons).toEqual(['a landing source file changed', 'a root workspace or dependency input changed'])
  })
})
