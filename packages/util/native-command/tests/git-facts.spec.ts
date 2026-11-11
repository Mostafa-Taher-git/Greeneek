/** Read-only git facts behavior, against a scripted command runner. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { gitFacts, type GitFactsInternals } from '../src/index.ts'
import type { NativeCommandRunner } from '../src/runner.ts'

const signal = (): AbortSignal => new AbortController().signal

/** A runner that answers each git invocation from a fixed map. */
function runnerFor(answers: Record<string, string>): NativeCommandRunner {
  return vi.fn<NativeCommandRunner>(async (_command, args) => {
    const key = args.slice(2).join(' ')
    const answer = answers[key]
    if (answer === undefined) throw new Error(`unexpected git ${key}`)
    return { stdout: answer, stderr: '' }
  })
}

function internals(answers: Record<string, string>): GitFactsInternals {
  return { run: runnerFor(answers) }
}

describe('git facts', () => {
  it('reports no facts for a directory outside a repository', async () => {
    const facts = await gitFacts('/projects/plain', signal(), internals({
      'rev-parse --is-inside-work-tree': 'false',
    }))
    expect(facts).toEqual({ isRepository: false, changedFiles: 0, insertions: 0, deletions: 0 })
  })

  it('reports the branch, the base branch, and the change size', async () => {
    const facts = await gitFacts('/projects/app', signal(), internals({
      'rev-parse --is-inside-work-tree': 'true',
      'rev-parse --abbrev-ref HEAD': 'feature/header\n',
      'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
      'diff --numstat main': '12\t3\tsrc/a.ts\n40\t0\tsrc/b.ts\n',
    }))
    expect(facts).toEqual({
      isRepository: true,
      branch: 'feature/header',
      baseBranch: 'main',
      changedFiles: 2,
      insertions: 52,
      deletions: 3,
    })
  })

  it('counts a binary file as changed without line counts', async () => {
    const facts = await gitFacts('/projects/app', signal(), internals({
      'rev-parse --is-inside-work-tree': 'true',
      'rev-parse --abbrev-ref HEAD': 'main',
      'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
      'diff --numstat main': '-\t-\tassets/logo.png\n',
    }))
    expect(facts.changedFiles).toBe(1)
    expect(facts.insertions).toBe(0)
    expect(facts.deletions).toBe(0)
  })

  it('falls back to the working tree when no base branch is known', async () => {
    const facts = await gitFacts('/projects/app', signal(), internals({
      'rev-parse --is-inside-work-tree': 'true',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-parse --abbrev-ref origin/HEAD': '',
      'diff --numstat HEAD': '1\t1\tsrc/a.ts\n',
    }))
    expect(facts.baseBranch).toBeUndefined()
    expect(facts.changedFiles).toBe(1)
  })

  it('reports a detached head without a branch name', async () => {
    const facts = await gitFacts('/projects/app', signal(), internals({
      'rev-parse --is-inside-work-tree': 'true',
      'rev-parse --abbrev-ref HEAD': 'HEAD',
      'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
      'diff --numstat main': '',
    }))
    expect(facts.branch).toBeUndefined()
    expect(facts.baseBranch).toBe('main')
  })

  it('reports no facts when git is missing', async () => {
    const facts = await gitFacts('/projects/app', signal(), {
      run: vi.fn<NativeCommandRunner>(async () => { throw new Error('git not found') }),
    })
    expect(facts).toEqual({ isRepository: false, changedFiles: 0, insertions: 0, deletions: 0 })
  })

  it('reports no branch when git names none', async () => {
    const facts = await gitFacts('/projects/app', signal(), internals({
      'rev-parse --is-inside-work-tree': 'true',
      'rev-parse --abbrev-ref HEAD': '',
      'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
      'diff --numstat main': '',
    }))
    expect(facts.branch).toBeUndefined()
    expect(facts.baseBranch).toBe('main')
  })

  it('reports no branch when git cannot name one', async () => {
    const facts = await gitFacts('/projects/app', signal(), {
      run: vi.fn<NativeCommandRunner>(async (_command, args) => {
        const key = args.slice(2).join(' ')
        if (key === 'rev-parse --is-inside-work-tree') return { stdout: 'true\n', stderr: '' }
        if (key === 'symbolic-ref --short refs/remotes/origin/HEAD') return { stdout: 'origin/main\n', stderr: '' }
        throw new Error('unknown revision')
      }),
    })
    expect(facts.branch).toBeUndefined()
    expect(facts.baseBranch).toBe('main')
  })

  it('ignores a malformed change line', async () => {
    const facts = await gitFacts('/projects/app', signal(), internals({
      'rev-parse --is-inside-work-tree': 'true',
      'rev-parse --abbrev-ref HEAD': 'main',
      'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
      'diff --numstat main': 'not-a-numstat-line\n',
    }))
    expect(facts.changedFiles).toBe(1)
    expect(facts.insertions).toBe(0)
    expect(facts.deletions).toBe(0)
  })

  it('runs git in the project directory without a shell', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: 'true\n', stderr: '' }))
    await gitFacts('/projects/app', signal(), { run })
    expect(run).toHaveBeenCalledWith('git', ['-C', '/projects/app', 'rev-parse', '--is-inside-work-tree'], expect.any(AbortSignal))
  })

  it('reads a directory that is not a repository with the host git', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gnk-git-facts-'))
    const facts = await gitFacts(directory, signal())
    expect(facts.isRepository).toBe(false)
    expect(facts.changedFiles).toBe(0)
  })
})
