import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@greeneek/gnk-session'
import { TeamError } from '../src/error.ts'
import { LaneLifecycleManager } from '../src/lane-lifecycle.ts'
import type { LaneRecord } from '../src/lane-lifecycle.ts'
import { WorktreeManager } from '../src/worktrees.ts'
import type { WorktreeGitRunner } from '../src/worktrees.ts'

const SIGNAL = new AbortController().signal
const SESSION = SessionId('session-one')
const CHILD = SessionId('child-one')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** One isolated temp directory removed after the test. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-lanes-'))
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

/** One committed repository with deterministic identity, signing, and endings. */
function repository(): string {
  const root = tempRoot()
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'lane-test@example.com')
  git(root, 'config', 'user.name', 'Lane Test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'gc.auto', '0')
  git(root, 'config', 'maintenance.auto', 'false')
  writeFileSync(join(root, 'README.md'), 'base\n')
  git(root, 'add', 'README.md')
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

/** Create one isolated lane through the manager under test. */
function createLane(
  manager: LaneLifecycleManager,
  repo: string,
  lane: string,
  writeScopes: readonly string[] = ['src'],
) {
  return manager.create({
    sessionId: SESSION,
    lane,
    childSessionId: CHILD,
    cwd: repo,
    writeScopes,
    signal: SIGNAL,
  })
}

/** Write one durable record directly for recovery scenarios. */
function writeRecord(gnkHome: string, record: LaneRecord): void {
  const dir = join(gnkHome, 'lanes', record.sessionId, record.lane)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lane.json'), JSON.stringify(record))
}

describe('lane lifecycle', { timeout: 30_000 }, () => {
  it('creates a ready checkout with durable scopes and base revision', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })

    const lane = await createLane(manager, repo, 'alpha', ['./src/', 'docs'])

    expect(lane.stage).toBe('ready')
    expect(lane.writeScopes).toEqual(['src', 'docs'])
    expect(lane.baseRevision).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(existsSync(join(lane.path, 'README.md'))).toBe(true)
    expect(await manager.activeScopes(SESSION)).toEqual([{ lane: 'alpha', writeScopes: ['src', 'docs'] }])
    const records = await manager.list(SESSION)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ lane: 'alpha', stage: 'ready' })
  })

  it('refuses overlapping active scopes before creating a checkout', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })

    await createLane(manager, repo, 'alpha', ['src'])
    const error = await rejection(createLane(manager, repo, 'beta', ['src/nested']))

    expect(error.code).toBe('TEAM_LANE_SCOPE_OVERLAP')
    expect(existsSync(join(realpathSync(gnkHome), 'worktrees', SESSION, 'beta'))).toBe(false)
    expect(git(repo, 'branch', '--list', 'gnk-lane/*/beta')).toBe('')
  })

  it('records a failed lane and removes a partial checkout when creation refuses', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    git(repo, 'branch', 'gnk-lane/session-one/alpha')

    const error = await rejection(createLane(manager, repo, 'alpha'))

    expect(error.message).toContain('already has branch')
    expect(git(repo, 'branch', '--list', 'gnk-lane/session-one/alpha')).toBe('')
    expect((await manager.list(SESSION))[0]).toMatchObject({ lane: 'alpha', stage: 'failed' })
  })

  it('checkpoints tracked and untracked changes into one exact patch', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const lane = await createLane(manager, repo, 'alpha')

    writeFileSync(join(lane.path, 'README.md'), 'changed\n')
    writeFileSync(join(lane.path, 'new.txt'), 'untracked\n')
    const checkpoint = await manager.checkpoint(lane, SIGNAL)

    expect(checkpoint.hash).toHaveLength(64)
    expect(checkpoint.bytes).toBeGreaterThan(0)
    expect(existsSync(checkpoint.path)).toBe(true)
    const patch = readFileSync(checkpoint.path, 'utf8')
    expect(patch).toContain('README.md')
    expect(patch).toContain('new.txt')
    expect(git(repo, 'apply', '--check', checkpoint.path)).toBe('')
    expect((await manager.list(SESSION))[0]).toMatchObject({
      stage: 'ready',
      checkpoint: { hash: checkpoint.hash, bytes: checkpoint.bytes },
    })
    expect(await manager.readPatch(lane, checkpoint.hash, SIGNAL)).toEqual(Buffer.from(patch, 'utf8'))
    expect((await rejection(manager.readPatch(lane, '0'.repeat(64), SIGNAL))).code)
      .toBe('TEAM_LANE_PATCH_CHANGED')
  })

  it('quarantines a lane whose HEAD moved past its recorded base', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const lane = await createLane(manager, repo, 'alpha')

    writeFileSync(join(lane.path, 'README.md'), 'member commit\n')
    git(lane.path, 'add', 'README.md')
    git(lane.path, 'commit', '-qm', 'bypass')

    expect((await rejection(manager.checkpoint(lane, SIGNAL))).code).toBe('TEAM_LANE_HEAD_MOVED')
    const quarantined = (await manager.list(SESSION))[0]
    expect(quarantined?.stage).toBe('quarantined')
    expect(quarantined?.diagnostic).toContain('moved from recorded base')
  })

  it('discards a lane only after checkpointing its unmerged work', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const lane = await createLane(manager, repo, 'alpha')
    writeFileSync(join(lane.path, 'new.txt'), 'only copy\n')

    const checkpoint = await manager.discard(lane, SIGNAL)

    expect(existsSync(checkpoint.path)).toBe(true)
    expect(readFileSync(checkpoint.path, 'utf8')).toContain('only copy')
    expect(existsSync(lane.path)).toBe(false)
    expect(git(repo, 'branch', '--list', 'gnk-lane/session-one/alpha')).toBe('')
    expect((await manager.list(SESSION))[0]).toMatchObject({ lane: 'alpha', stage: 'discarded' })
  })

  it('rolls back an interrupted create and leaves a ready lane untouched', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const ready = await createLane(manager, repo, 'ready', ['src'])
    const base = git(repo, 'rev-parse', 'HEAD')
    await new WorktreeManager({ repositoryRoot: repo, gnkHome })
      .create({ sessionId: SESSION, lane: 'interrupted', signal: SIGNAL })
    writeRecord(gnkHome, {
      version: 1,
      sessionId: SESSION,
      lane: 'interrupted' as LaneRecord['lane'],
      childSessionId: CHILD,
      repositoryRoot: realpathSync(repo),
      path: join(realpathSync(gnkHome), 'worktrees', SESSION, 'interrupted'),
      branch: 'gnk-lane/session-one/interrupted',
      baseRevision: base as LaneRecord['baseRevision'],
      writeScopes: ['docs'],
      stage: 'preparing',
      createdAt: Date.now(),
    })

    await manager.recover(SESSION, SIGNAL)

    expect(existsSync(join(realpathSync(gnkHome), 'worktrees', SESSION, 'interrupted'))).toBe(false)
    expect(git(repo, 'branch', '--list', 'gnk-lane/*/interrupted')).toBe('')
    expect(existsSync(ready.path)).toBe(true)
    const records = await manager.list(SESSION)
    expect(records.find(record => record.lane === 'interrupted')?.stage).toBe('failed')
    expect(records.find(record => record.lane === 'ready')?.stage).toBe('ready')
  })

  it('refuses a checkpoint or removal after a terminal transition', async () => {
    const repo = repository()
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot() })
    const lane = await createLane(manager, repo, 'alpha')
    expect((await rejection(manager.readPatch(lane, 'a'.repeat(64), SIGNAL))).code)
      .toBe('TEAM_LANE_NO_CHECKPOINT')
    await manager.discard(lane, SIGNAL)

    expect((await rejection(manager.checkpoint(lane, SIGNAL))).code).toBe('TEAM_LANE_NOT_READY')
    expect((await rejection(manager.discard(lane, SIGNAL))).code).toBe('TEAM_LANE_NOT_READY')
    expect((await rejection(manager.settleMerged(lane, 'a'.repeat(64), SIGNAL))).code)
      .toBe('TEAM_LANE_NOT_READY')
  })

  it('refuses an oversized patch and a rewritten checkpoint path', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const small = new LaneLifecycleManager({ gnkHome, maxPatchBytes: 1 })
    const lane = await createLane(small, repo, 'alpha')
    writeFileSync(join(lane.path, 'new.txt'), 'too large\n')
    expect((await rejection(small.checkpoint(lane, SIGNAL))).code).toBe('TEAM_LANE_PATCH_TOO_LARGE')

    const manager = new LaneLifecycleManager({ gnkHome })
    const checkpoint = await manager.checkpoint(lane, SIGNAL)
    const recordPath = join(gnkHome, 'lanes', SESSION, 'alpha', 'lane.json')
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as LaneRecord
    writeFileSync(recordPath, JSON.stringify({
      ...record,
      checkpoint: { ...record.checkpoint, path: join(gnkHome, 'other.patch') },
    }))
    expect((await rejection(manager.readPatch(lane, checkpoint.hash, SIGNAL))).code)
      .toBe('TEAM_LANE_PATCH_CHANGED')
  })

  it('keeps a lane ready when it changed after integration', async () => {
    const repo = repository()
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot() })
    const lane = await createLane(manager, repo, 'alpha')
    writeFileSync(join(lane.path, 'new.txt'), 'reviewed\n')
    const checkpoint = await manager.checkpoint(lane, SIGNAL)
    writeFileSync(join(lane.path, 'new.txt'), 'changed later\n')

    expect((await rejection(manager.settleMerged(lane, checkpoint.hash, SIGNAL))).code)
      .toBe('TEAM_LANE_PATCH_CHANGED')
    expect((await manager.list(SESSION))[0]?.stage).toBe('ready')
    expect(existsSync(lane.path)).toBe(true)
  })

  it('reports a closing lane as active and finishes its recorded removal', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const base = git(repo, 'rev-parse', 'HEAD')
    await new WorktreeManager({ repositoryRoot: repo, gnkHome })
      .create({ sessionId: SESSION, lane: 'closing', signal: SIGNAL })
    writeRecord(gnkHome, {
      version: 1,
      sessionId: SESSION,
      lane: 'closing' as LaneRecord['lane'],
      childSessionId: CHILD,
      repositoryRoot: realpathSync(repo),
      path: join(realpathSync(gnkHome), 'worktrees', SESSION, 'closing'),
      branch: 'gnk-lane/session-one/closing',
      baseRevision: base as LaneRecord['baseRevision'],
      writeScopes: ['src'],
      stage: 'closing',
      createdAt: Date.now(),
      diagnostic: 'merged',
    })

    expect((await manager.activeScopes(SESSION)).map(lane => lane.lane)).toEqual(['closing'])
    await manager.recover(SESSION, SIGNAL)

    expect(existsSync(join(realpathSync(gnkHome), 'worktrees', SESSION, 'closing'))).toBe(false)
    const recovered = (await manager.list(SESSION))[0]
    expect(recovered?.lane).toBe('closing')
    expect(recovered?.stage).toBe('merged')
    expect(recovered?.diagnostic).toContain('startup recovery')
  })

  it('refuses creation without a checkout cwd or with a duplicate record', async () => {
    const repo = repository()
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot() })
    expect((await rejection(manager.create({
      sessionId: SESSION,
      lane: 'alpha',
      childSessionId: CHILD,
      cwd: undefined,
      writeScopes: ['src'],
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_NO_REPOSITORY')

    await createLane(manager, repo, 'alpha')
    expect((await rejection(createLane(manager, repo, 'alpha'))).code).toBe('TEAM_LANE_DUPLICATE')
  })

  it('refuses empty scopes, a blank cwd, and a missing lane record', async () => {
    const repo = repository()
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot() })
    expect((await rejection(manager.create({
      sessionId: SESSION,
      lane: 'alpha',
      childSessionId: CHILD,
      cwd: repo,
      writeScopes: [],
      signal: SIGNAL,
    }))).code).toBe('TEAM_INVALID_LANE_POLICY')
    expect((await rejection(manager.create({
      sessionId: SESSION,
      lane: 'alpha',
      childSessionId: CHILD,
      cwd: '   ',
      writeScopes: ['src'],
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_NO_REPOSITORY')
    await expect(manager.readPatch({
      sessionId: SESSION,
      lane: 'absent',
    } as LaneRecord, 'hash', SIGNAL)).rejects.toMatchObject({ code: 'TEAM_LANE_NOT_FOUND' })
  })

  it('reports an invalid JSON lane record', async () => {
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    mkdirSync(join(gnkHome, 'lanes', SESSION, 'broken'), { recursive: true })
    writeFileSync(join(gnkHome, 'lanes', SESSION, 'broken', 'lane.json'), '{')
    expect((await rejection(manager.list(SESSION))).code).toBe('TEAM_LANE_RECORD_INVALID')
  })

  it('serializes reads for one Lead without losing the queue cleanup', async () => {
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot() })
    const [first, second] = await Promise.all([manager.list(SESSION), manager.list(SESSION)])
    expect(first).toEqual([])
    expect(second).toEqual([])
  })

  it('refuses patch bytes changed after the reviewed checkpoint', async () => {
    const repo = repository()
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot() })
    const lane = await createLane(manager, repo, 'alpha')
    writeFileSync(join(lane.path, 'new.txt'), 'reviewed\n')
    const checkpoint = await manager.checkpoint(lane, SIGNAL)
    writeFileSync(checkpoint.path, 'tampered\n')

    expect((await rejection(manager.readPatch(lane, checkpoint.hash, SIGNAL))).code)
      .toBe('TEAM_LANE_PATCH_CHANGED')
  })

  it('finishes a closing lane as discarded when it was not a merge', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const base = git(repo, 'rev-parse', 'HEAD')
    await new WorktreeManager({ repositoryRoot: repo, gnkHome })
      .create({ sessionId: SESSION, lane: 'discarded', signal: SIGNAL })
    writeRecord(gnkHome, {
      version: 1,
      sessionId: SESSION,
      lane: 'discarded' as LaneRecord['lane'],
      childSessionId: CHILD,
      repositoryRoot: realpathSync(repo),
      path: join(realpathSync(gnkHome), 'worktrees', SESSION, 'discarded'),
      branch: 'gnk-lane/session-one/discarded',
      baseRevision: base as LaneRecord['baseRevision'],
      writeScopes: ['src'],
      stage: 'closing',
      createdAt: Date.now(),
      diagnostic: 'discarded',
    })

    await manager.recover(SESSION, SIGNAL)

    expect((await manager.list(SESSION))[0]).toMatchObject({ lane: 'discarded', stage: 'discarded' })
  })

  it('reports a git root lookup that prints nothing', async () => {
    const manager = new LaneLifecycleManager({
      gnkHome: tempRoot(),
      runGit: async () => '',
    })
    expect((await rejection(manager.create({
      sessionId: SESSION,
      lane: 'alpha',
      childSessionId: CHILD,
      cwd: tempRoot(),
      writeScopes: ['src'],
      signal: SIGNAL,
    }))).code).toBe('TEAM_LANE_NO_REPOSITORY')
  })

  it('reports a record directory it cannot read and ignores a directory without a record', async () => {
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    mkdirSync(join(gnkHome, 'lanes'), { recursive: true })
    writeFileSync(join(gnkHome, 'lanes', SESSION), 'not a directory')
    await expect(manager.list(SESSION)).rejects.toMatchObject({ code: 'ENOTDIR' })

    rmSync(join(gnkHome, 'lanes', SESSION), { force: true })
    mkdirSync(join(gnkHome, 'lanes', SESSION, 'empty'), { recursive: true })
    await expect(manager.list(SESSION)).resolves.toEqual([])
  })

  it('reports invalid JSON when a lane is read directly', async () => {
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    mkdirSync(join(gnkHome, 'lanes', SESSION, 'broken'), { recursive: true })
    writeFileSync(join(gnkHome, 'lanes', SESSION, 'broken', 'lane.json'), 'not json')
    const record = { sessionId: SESSION, lane: 'broken' } as LaneRecord
    await expect(manager.readPatch(record, 'hash', SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_LANE_RECORD_INVALID' })
  })

  it('reports a lane git failure and a failed cleanup during recovery', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    const lane = await createLane(manager, repo, 'alpha')
    const recordPath = join(gnkHome, 'lanes', SESSION, 'alpha', 'lane.json')
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as LaneRecord
    writeFileSync(recordPath, JSON.stringify({ ...record, path: join(repo, 'absent-checkout') }))
    expect((await rejection(manager.checkpoint(lane, SIGNAL))).code).toBe('TEAM_LANE_GIT_FAILED')

    writeRecord(gnkHome, {
      ...record,
      lane: 'broken' as LaneRecord['lane'],
      repositoryRoot: join(repo, 'not-a-repository'),
      path: join(gnkHome, 'worktrees', SESSION, 'broken'),
      branch: 'gnk-lane/session-one/broken',
      stage: 'closing',
      diagnostic: 'discarded',
    })
    await manager.recover(SESSION, SIGNAL)
    expect((await manager.list(SESSION)).find(candidate => candidate.lane === 'broken')?.stage).toBe('failed')
  })

  it('fails a lane and its cleanup together when the checkout cannot be removed', async () => {
    const repositoryRoot = repository()
    const base = git(repositoryRoot, 'rev-parse', 'HEAD')
    const runGit: WorktreeGitRunner = async ({ argv }) => {
      if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') return repositoryRoot
      if (argv[0] === 'rev-parse' && argv[1] === 'HEAD') return base
      if (argv[0] === 'rev-parse' && argv.includes('--verify')) return ''
      if (argv[0] === 'worktree' && argv[1] === 'add') throw new Error('worktree add refused')
      if (argv[0] === 'worktree' && argv[1] === 'list') return ''
      if (argv[0] === 'worktree' && argv[1] === 'prune') return ''
      if (argv[0] === 'branch') throw new Error('branch delete refused')
      return ''
    }
    const manager = new LaneLifecycleManager({ gnkHome: tempRoot(), runGit })

    await expect(manager.create({
      sessionId: SESSION,
      lane: 'alpha',
      childSessionId: CHILD,
      cwd: repositoryRoot,
      writeScopes: ['src'],
      signal: SIGNAL,
    })).rejects.toThrow('creation and cleanup both failed')
    const record = (await manager.list(SESSION))[0]
    expect(record).toMatchObject({ lane: 'alpha', stage: 'failed' })
    expect(record?.diagnostic).toContain('cleanup also failed')
  })

  it('refuses a Lead checkout outside a Git work tree', async () => {
    const gnkHome = tempRoot()
    const notRepository = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })

    expect((await rejection(createLane(manager, notRepository, 'alpha'))).code)
      .toBe('TEAM_LANE_NO_REPOSITORY')
    expect(await manager.list(SESSION)).toEqual([])
  })

  it('rejects a malformed durable lane record', async () => {
    const gnkHome = tempRoot()
    const manager = new LaneLifecycleManager({ gnkHome })
    mkdirSync(join(gnkHome, 'lanes', SESSION, 'broken'), { recursive: true })
    writeFileSync(join(gnkHome, 'lanes', SESSION, 'broken', 'lane.json'), '{"version":1}')

    expect((await rejection(manager.list(SESSION))).code).toBe('TEAM_LANE_RECORD_INVALID')
  })
})
