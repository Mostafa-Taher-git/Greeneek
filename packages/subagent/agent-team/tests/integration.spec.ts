import { execFileSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@greeneek/gnk-session'
import { TeamError } from '../src/error.ts'
import { LaneIntegration } from '../src/integration.ts'
import { LaneLifecycleManager } from '../src/lane-lifecycle.ts'
import type { LaneRecord } from '../src/lane-lifecycle.ts'

const SIGNAL = new AbortController().signal
const SESSION = SessionId('session-one')
const roots: string[] = []
const PASS = { argv: [process.execPath, '-e', 'process.exit(0)'] } as const
const FAIL = { argv: [process.execPath, '-e', 'process.exit(1)'] } as const

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {
    recursive: true, force: true, maxRetries: 20, retryDelay: 150,
  })
})

/** One isolated temp directory removed after the test. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-integration-'))
  roots.push(root)
  return root
}

/** Run git without a shell and return trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim()
}

/** One committed repository with three independent text files. */
function repository(): string {
  const root = tempRoot()
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'integration-test@example.com')
  git(root, 'config', 'user.name', 'Integration Test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'gc.auto', '0')
  git(root, 'config', 'maintenance.auto', 'false')
  for (const file of ['a.txt', 'b.txt', 'c.txt', 'README.md']) writeFileSync(join(root, file), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'base')
  return root
}

/** Await one rejection and keep its typed Team error. */
async function rejection(operation: Promise<unknown>): Promise<TeamError> {
  try {
    await operation
  } catch (error) {
    if (error instanceof TeamError) return error
    throw error
  }
  throw new Error('expected the operation to reject')
}

/** One lane manager/integration pair over a shared harness home. */
function harness(): {
  lanes: LaneLifecycleManager
  merge: LaneIntegration
  gnkHome: string
} {
  const gnkHome = tempRoot()
  const lanes = new LaneLifecycleManager({ gnkHome })
  return { lanes, merge: new LaneIntegration({ lanes }), gnkHome }
}

/** Create one lane, edit a file, and checkpoint it. */
async function preparedLane(
  lanes: LaneLifecycleManager,
  repo: string,
  lane: string,
  file: string,
  content: string,
): Promise<{ record: LaneRecord; patchHash: string }> {
  const record = await lanes.create({
    sessionId: SESSION,
    lane,
    childSessionId: SessionId(`child-${lane}`),
    cwd: repo,
    writeScopes: [lane],
    signal: SIGNAL,
  })
  writeFileSync(join(record.path, file), content)
  const checkpoint = await lanes.checkpoint(record, SIGNAL)
  return { record, patchHash: checkpoint.hash }
}

describe('reviewed lane integration', { timeout: 30_000 }, () => {
  it('applies a reviewed patch, runs gates, commits, and removes the lane', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')

    const result = await merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    })

    expect(result.patchHash).toBe(patchHash)
    expect(result.primaryHead).not.toBe(base)
    expect(git(repo, 'show', '--stat', '--oneline', 'HEAD')).toContain('merge alpha')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('alpha\n')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(git(repo, 'branch', '--list', 'gnk-lane/*/alpha')).toBe('')
    expect((await lanes.list(SESSION)).find(record => record.lane === 'alpha')?.stage).toBe('merged')
    expect(result.gates).toHaveLength(1)
  })

  it('treats an empty lane as a merged no-op without an empty commit', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const record = await lanes.create({
      sessionId: SESSION,
      lane: 'empty',
      childSessionId: SessionId('child-empty'),
      cwd: repo,
      writeScopes: ['empty'],
      signal: SIGNAL,
    })
    const checkpoint = await lanes.checkpoint(record, SIGNAL)

    const result = await merge.integrate({
      sessionId: SESSION,
      lane: 'empty',
      expectedPrimaryHead: base,
      patchHash: checkpoint.hash,
      gateCommands: [PASS],
      commitMessage: 'merge empty',
      signal: SIGNAL,
    })

    expect(result.primaryHead).toBe(base)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(base)
    expect((await lanes.list(SESSION))[0]?.stage).toBe('merged')
  })

  it('refuses a primary checkout that moved or is dirty', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: '0'.repeat(40),
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_PRIMARY_MOVED')
    expect(merge.haltReason(SESSION)).toContain('does not match expected')
    merge.resume(SESSION)

    writeFileSync(join(repo, 'dirty.txt'), 'dirty\n')
    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_PRIMARY_DIRTY')
    expect(git(repo, 'status', '--porcelain')).toContain('dirty.txt')
  })

  it('halts the queue when the lane changed after review', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { record, patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'reviewed\n')
    writeFileSync(join(record.path, 'README.md'), 'changed after review\n')

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_PATCH_CHANGED')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(base)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(merge.haltReason(SESSION)).toContain('changed after review')

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_QUEUE_HALTED')
  })

  it('reverses an applied patch when a gate fails and keeps the lane', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { record, patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [FAIL],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_GATE_FAILED')

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(base)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('base\n')
    expect(existsSync(record.path)).toBe(true)
    expect((await lanes.list(SESSION))[0]).toMatchObject({ lane: 'alpha', stage: 'ready' })
    expect(merge.haltReason(SESSION)).toContain('gate')
  })

  it('stops a serial merge on a conflict and keeps both lanes', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const alpha = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')
    const beta = await preparedLane(lanes, repo, 'beta', 'README.md', 'beta\n')

    const first = await merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash: alpha.patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    })
    const conflict = await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'beta',
      expectedPrimaryHead: first.primaryHead,
      patchHash: beta.patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge beta',
      signal: SIGNAL,
    }))

    expect(conflict.code).toBe('TEAM_LANE_MERGE_CONFLICT')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('alpha\n')
    expect(existsSync(alpha.record.path)).toBe(false)
    expect(existsSync(beta.record.path)).toBe(true)
    expect(merge.haltReason(SESSION)).toContain('conflicts')
  }, 20_000)

  it('refuses an absent or terminal lane and serializes concurrent admissions', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'absent',
      expectedPrimaryHead: base,
      patchHash: 'hash',
      gateCommands: [],
      commitMessage: 'merge absent',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_NOT_FOUND')
    expect(merge.haltReason(SESSION)).toContain('not found')
    merge.resume(SESSION)

    const record = await lanes.create({
      sessionId: SESSION,
      lane: 'empty',
      childSessionId: SessionId('child-empty'),
      cwd: repo,
      writeScopes: ['empty'],
      signal: SIGNAL,
    })
    const checkpoint = await lanes.checkpoint(record, SIGNAL)
    await merge.integrate({
      sessionId: SESSION,
      lane: 'empty',
      expectedPrimaryHead: base,
      patchHash: checkpoint.hash,
      gateCommands: [],
      commitMessage: 'merge empty',
      signal: SIGNAL,
    })
    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'empty',
      expectedPrimaryHead: base,
      patchHash: checkpoint.hash,
      gateCommands: [],
      commitMessage: 'merge empty again',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_NOT_READY')
    merge.resume(SESSION)

    const settled = await Promise.allSettled([
      merge.integrate({
        sessionId: SESSION,
        lane: 'first-absent',
        expectedPrimaryHead: base,
        patchHash: 'hash',
        gateCommands: [],
        commitMessage: 'merge',
        signal: SIGNAL,
      }),
      merge.integrate({
        sessionId: SESSION,
        lane: 'second-absent',
        expectedPrimaryHead: base,
        patchHash: 'hash',
        gateCommands: [],
        commitMessage: 'merge',
        signal: SIGNAL,
      }),
    ])
    expect(settled.every(result => result.status === 'rejected')).toBe(true)
  })

  it('reports a git failure from a missing recorded repository', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge, gnkHome } = harness()
    await lanes.create({
      sessionId: SESSION,
      lane: 'alpha',
      childSessionId: SessionId('child-alpha'),
      cwd: repo,
      writeScopes: ['alpha'],
      signal: SIGNAL,
    })
    const recordPath = join(gnkHome, 'lanes', SESSION, 'alpha', 'lane.json')
    const stored = JSON.parse(readFileSync(recordPath, 'utf8')) as LaneRecord
    writeFileSync(recordPath, JSON.stringify({ ...stored, repositoryRoot: join(repo, 'absent') }))

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash: 'hash',
      gateCommands: [],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_GIT_FAILED')
  })

  it('reports a rollback that could not reverse a gate-mutated primary', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')
    const mutateThenFail = {
      argv: [process.execPath, '-e', "require('node:fs').writeFileSync('README.md','gate drift\\n');process.exit(1)"],
    } as const

    const error = await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [mutateThenFail],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))

    expect(error.code).toBe('TEAM_LANE_GATE_FAILED')
    expect(error.message).toContain('automatic reversal failed')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('gate drift\n')
  })

  it('reverses the patch and reports a non-gate integration failure when commit refuses', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')
    const hooks = tempRoot()
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(hooks, 'pre-commit'), 0o755)
    git(repo, 'config', 'core.hooksPath', hooks)

    const error = await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))

    expect(error.code).toBe('TEAM_LANE_INTEGRATION_FAILED')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(base)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('base\n')
  })

  it('propagates an unexpected non-Team failure without halting the queue', async () => {
    const merge = new LaneIntegration({
      lanes: {
        async list() {
          throw new Error('unexpected store failure')
        },
      } as never,
    })

    await expect(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: 'head',
      patchHash: 'hash',
      gateCommands: [],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    })).rejects.toThrow('unexpected store failure')
    expect(merge.haltReason(SESSION)).toBeUndefined()
  })

  it('refuses a gate command with no executable', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')

    const error = await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [{ argv: [] }],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))

    expect(error.code).toBe('TEAM_LANE_GATE_FAILED')
    expect(error.message).toContain('no executable')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('quarantines a lane that committed after its base', async () => {
    const repo = repository()
    const base = git(repo, 'rev-parse', 'HEAD')
    const { lanes, merge } = harness()
    const { record, patchHash } = await preparedLane(lanes, repo, 'alpha', 'README.md', 'alpha\n')
    writeFileSync(join(record.path, 'a.txt'), 'member commit\n')
    git(record.path, 'add', 'a.txt')
    git(record.path, 'commit', '-qm', 'bypass')

    expect((await rejection(merge.integrate({
      sessionId: SESSION,
      lane: 'alpha',
      expectedPrimaryHead: base,
      patchHash,
      gateCommands: [PASS],
      commitMessage: 'merge alpha',
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_HEAD_MOVED')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect((await lanes.list(SESSION))[0]?.stage).toBe('quarantined')
  })
})
