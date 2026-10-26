import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@greeneek/gnk-session'
import { WorktreeError, WorktreeManager } from '../src/index.ts'

const SIGNAL = new AbortController().signal
const SESSION = SessionId('session-one')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** One isolated temp directory removed after the test. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-worktrees-'))
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
  git(root, 'config', 'user.email', 'worktree-test@example.com')
  git(root, 'config', 'user.name', 'Worktree Test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  // A background auto-gc can still hold pack files when the test removes the
  // repository, which fails the directory delete on Windows.
  git(root, 'config', 'gc.auto', '0')
  git(root, 'config', 'maintenance.auto', 'false')
  writeFileSync(join(root, 'README.md'), 'base\n')
  git(root, 'add', 'README.md')
  git(root, 'commit', '-qm', 'base')
  return root
}

/** Link one directory without requiring Windows developer mode. */
function linkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Compare a git-reported path with a Node path on every platform. */
function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

function managerFor(repositoryRoot: string, gnkHome: string): WorktreeManager {
  return new WorktreeManager({ repositoryRoot, gnkHome })
}

/** Await one rejection and keep its typed lane worktree error. */
async function rejection(operation: Promise<unknown>): Promise<WorktreeError> {
  try {
    await operation
  } catch (error) {
    if (error instanceof WorktreeError) return error
    throw error
  }
  throw new Error('expected the operation to reject')
}

describe('lane worktrees', () => {
  it('gives each lane its own checkout under the session worktree root', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = managerFor(repo, gnkHome)

    const alpha = await manager.create({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL })
    const beta = await manager.create({ sessionId: SESSION, lane: 'beta', signal: SIGNAL })

    expect(alpha.path).toBe(join(realpathSync(gnkHome), 'worktrees', 'session-one', 'alpha'))
    expect(beta.path).toBe(join(realpathSync(gnkHome), 'worktrees', 'session-one', 'beta'))
    expect(alpha.branch).toBe('gnk-lane/session-one/alpha')
    expect(beta.branch).toBe('gnk-lane/session-one/beta')

    writeFileSync(join(alpha.path, 'shared.txt'), 'alpha\n')
    writeFileSync(join(beta.path, 'shared.txt'), 'beta\n')

    expect(readFileSync(join(alpha.path, 'shared.txt'), 'utf8')).toBe('alpha\n')
    expect(readFileSync(join(beta.path, 'shared.txt'), 'utf8')).toBe('beta\n')
    expect(existsSync(join(repo, 'shared.txt'))).toBe(false)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('records the base revision and reports it from list', async () => {
    const repo = repository()
    const head = git(repo, 'rev-parse', 'HEAD')
    const manager = managerFor(repo, tempRoot())

    expect(await manager.list({ sessionId: SESSION, signal: SIGNAL })).toEqual([])

    const beta = await manager.create({ sessionId: SESSION, lane: 'beta', signal: SIGNAL })
    const alpha = await manager.create({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL })

    expect(beta.baseRevision).toBe(head)
    expect(alpha.baseRevision).toBe(head)
    expect(git(alpha.path, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'rev-parse', `refs/heads/${alpha.branch}`)).toBe(head)

    const lanes = await manager.list({ sessionId: SESSION, signal: SIGNAL })
    expect(lanes.map(lane => lane.lane)).toEqual(['alpha', 'beta'])
    expect(lanes).toEqual([alpha, beta])
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('refuses lane names that are not one safe path segment', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const manager = managerFor(repo, gnkHome)

    for (const lane of ['../escape', resolve(tmpdir(), 'escape'), 'a..b', 'lane.', 'lane.lock', '', 'a'.repeat(65)]) {
      expect((await rejection(manager.create({ sessionId: SESSION, lane, signal: SIGNAL }))).code)
        .toBe('WORKTREE_PATH_ESCAPE')
    }

    expect(existsSync(join(realpathSync(gnkHome), 'worktrees', 'escape'))).toBe(false)
    expect(git(repo, 'branch', '--list', 'gnk-lane/*')).toBe('')
  })

  it('refuses a session root that links outside the worktrees directory', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const outside = tempRoot()
    const sessionRoot = join(gnkHome, 'worktrees', 'session-one')
    mkdirSync(dirname(sessionRoot), { recursive: true })
    linkDirectory(outside, sessionRoot)
    const manager = managerFor(repo, gnkHome)

    try {
      expect((await rejection(manager.create({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL }))).code)
        .toBe('WORKTREE_PATH_ESCAPE')
      expect((await rejection(manager.list({ sessionId: SESSION, signal: SIGNAL }))).code)
        .toBe('WORKTREE_PATH_ESCAPE')
      expect((await rejection(manager.remove({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL }))).code)
        .toBe('WORKTREE_PATH_ESCAPE')
    } finally {
      unlinkSync(sessionRoot)
    }

    expect(readdirSync(outside)).toEqual([])
  })

  it('refuses to create over an existing checkout or lane branch', async () => {
    const repo = repository()
    const manager = managerFor(repo, tempRoot())
    const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }

    const created = await manager.create(request)
    expect((await rejection(manager.create(request))).code).toBe('WORKTREE_EXISTS')

    await manager.remove(request)
    git(repo, 'branch', created.branch, created.baseRevision)
    const collision = await rejection(manager.create(request))
    expect(collision.code).toBe('WORKTREE_EXISTS')
    expect(collision.message).toContain(created.branch)
  })

  it('removes the checkout and branch, and repeated removal succeeds', async () => {
    const repo = repository()
    const manager = managerFor(repo, tempRoot())
    const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }

    await manager.remove(request)

    const created = await manager.create(request)
    await manager.remove(request)

    expect(existsSync(created.path)).toBe(false)
    expect(git(repo, 'branch', '--list', created.branch)).toBe('')
    expect(portable(git(repo, 'worktree', 'list', '--porcelain'))).not.toContain(portable(created.path))
    await expect(manager.remove(request)).resolves.toBeUndefined()
    expect(await manager.list({ sessionId: SESSION, signal: SIGNAL })).toEqual([])
  })

  it('removes a checkout git still registers after its directory vanished', async () => {
    const repo = repository()
    const manager = managerFor(repo, tempRoot())
    const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }
    const created = await manager.create(request)

    rmSync(created.path, { recursive: true, force: true })

    expect(await manager.list({ sessionId: SESSION, signal: SIGNAL })).toEqual([])
    await manager.remove(request)
    expect(git(repo, 'branch', '--list', created.branch)).toBe('')
    expect(portable(git(repo, 'worktree', 'list', '--porcelain'))).not.toContain(portable(created.path))
  })

  it('removes a path git no longer registers', async () => {
    const repo = repository()
    const manager = managerFor(repo, tempRoot())
    const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }
    const created = await manager.create(request)

    rmSync(created.path, { recursive: true, force: true })
    writeFileSync(created.path, 'leftover\n')
    expect(await manager.list({ sessionId: SESSION, signal: SIGNAL })).toEqual([])
    git(repo, 'worktree', 'prune')

    await manager.remove(request)
    expect(existsSync(created.path)).toBe(false)
    expect(git(repo, 'branch', '--list', created.branch)).toBe('')
  })

  it('unlinks a link planted at the lane path without touching its target', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const outside = tempRoot()
    const sessionRoot = join(gnkHome, 'worktrees', 'session-one')
    mkdirSync(sessionRoot, { recursive: true })
    writeFileSync(join(outside, 'keep.txt'), 'keep\n')
    const planted = join(sessionRoot, 'alpha')
    linkDirectory(outside, planted)

    await managerFor(repo, gnkHome).remove({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL })

    expect(existsSync(planted)).toBe(false)
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep\n')
  })

  it('reports a branch that survives removal', async () => {
    const repo = repository()
    const manager = managerFor(repo, tempRoot())
    const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }
    const created = await manager.create(request)

    git(created.path, 'checkout', '--detach')
    git(repo, 'worktree', 'add', join(tempRoot(), 'copy'), created.branch)

    const failed = await rejection(manager.remove(request))
    expect(failed.code).toBe('WORKTREE_REMOVE_INCOMPLETE')
    expect(failed.message).toContain(created.branch)
    expect(existsSync(created.path)).toBe(false)
    expect(git(repo, 'branch', '--list', created.branch)).toContain(created.branch)
  })

  it.skipIf(process.platform !== 'win32')('reports a checkout a process holds as its working directory', async () => {
    const repo = repository()
    const manager = managerFor(repo, tempRoot())
    const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }
    const created = await manager.create(request)
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: created.path,
      stdio: 'ignore',
    })

    try {
      await new Promise<void>((spawned, failed) => {
        holder.once('spawn', () => { spawned() })
        holder.once('error', failed)
      })
      const failure = await rejection(manager.remove(request))
      expect(failure.code).toBe('WORKTREE_REMOVE_INCOMPLETE')
      expect(failure.message).toContain(created.path)
      expect(existsSync(created.path)).toBe(true)
    } finally {
      holder.kill()
      await new Promise<void>((exited) => { holder.once('exit', () => { exited() }) })
    }
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a checkout the filesystem refuses to remove',
    async () => {
      const repo = repository()
      const manager = managerFor(repo, tempRoot())
      const request = { sessionId: SESSION, lane: 'alpha', signal: SIGNAL }
      const created = await manager.create(request)
      const sessionRoot = dirname(created.path)

      chmodSync(sessionRoot, 0o500)
      try {
        const failure = await rejection(manager.remove(request))
        expect(failure.code).toBe('WORKTREE_REMOVE_INCOMPLETE')
        expect(failure.message).toContain(created.path)
      } finally {
        chmodSync(sessionRoot, 0o700)
      }
    },
  )

  it('routes every git command through the configured process boundary', async () => {
    const repo = repository()
    const invocations: string[][] = []
    const manager = new WorktreeManager({
      repositoryRoot: repo,
      gnkHome: tempRoot(),
      runGit: async ({ argv, cwd }) => {
        invocations.push([...argv])
        return execFileSync('git', argv, { cwd, encoding: 'utf8' })
      },
    })

    const created = await manager.create({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL })

    expect(invocations.map(argv => argv[0])).toEqual(['rev-parse', 'rev-parse', 'rev-parse', 'worktree'])
    expect(readFileSync(join(created.path, 'README.md'), 'utf8')).toBe('base\n')
  })

  it('fails loud outside a git repository', async () => {
    const notRepository = tempRoot()
    const gnkHome = tempRoot()

    const failed = await rejection(managerFor(notRepository, gnkHome)
      .create({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL }))
    expect(failed.code).toBe('WORKTREE_NOT_A_REPOSITORY')
    expect(failed.message).toContain(notRepository)
    expect(existsSync(join(gnkHome, 'worktrees'))).toBe(false)
  })

  it('fails loud when the repository has no commit to base a lane on', async () => {
    const repo = tempRoot()
    git(repo, 'init', '-q')
    const gnkHome = tempRoot()

    expect((await rejection(managerFor(repo, gnkHome).create({ sessionId: SESSION, lane: 'alpha', signal: SIGNAL }))).code)
      .toBe('WORKTREE_NO_BASE_REVISION')
    expect(existsSync(join(gnkHome, 'worktrees'))).toBe(false)
  })

  it('propagates the caller abort before touching the repository', async () => {
    const repo = repository()
    const gnkHome = tempRoot()
    const controller = new AbortController()
    const reason = new Error('lane cancelled')
    controller.abort(reason)

    await expect(managerFor(repo, gnkHome).create({ sessionId: SESSION, lane: 'alpha', signal: controller.signal }))
      .rejects.toBe(reason)
    expect(existsSync(join(gnkHome, 'worktrees'))).toBe(false)
    expect(git(repo, 'branch', '--list', 'gnk-lane/*')).toBe('')
  })
})
