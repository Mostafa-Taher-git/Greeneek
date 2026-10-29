import type { ToolExecution } from '@greeneek/gnk-tools'
import { describe, expect, it } from 'vitest'
import { gitMutation, laneGuardViolation } from '../src/lane-guard.ts'

const SIGNAL = new AbortController().signal

/** Minimal immutable execution view for the pure guard. */
function call(name: string, args: unknown): ToolExecution {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name,
    arguments: args,
    signal: SIGNAL,
    token: 'token-1',
  } as unknown as ToolExecution
}

describe('git mutation detection', () => {
  it('finds commit, merge, push, tag, and ref mutations in ordinary commands', () => {
    for (const command of [
      'git commit -m "work"',
      'git -C ../lane commit -m work',
      'env GIT_AUTHOR_NAME=x git push origin main',
      'echo done && git tag v1.0.0',
      'git update-ref refs/heads/main HEAD',
      'git branch -D feature',
      'git branch --move old new',
      'git checkout main',
      'git reset --hard HEAD~1',
      'git worktree remove ../lane',
      'npm test; git commit --amend',
      'bash -c "git merge feature"',
      'echo "hello world" && git tag v2',
      'git --no-pager commit -m x',
      'git -C .. --no-pager tag v3',
      'git -c user.name=lane commit -m x',
      'sh -c "git commit -m x',
    ]) {
      expect(gitMutation(command), command).toBeDefined()
    }
  })

  it('allows read-only git inspection and unrelated commands', () => {
    for (const command of [
      'git status --porcelain',
      'git log --oneline -5',
      'git diff HEAD',
      'git branch --list "gnk-lane/*"',
      'git rev-parse HEAD',
      'git show --stat',
      'echo commit && echo merge',
      'legit commit',
      'npm run commitlint',
      'git commit-tree HEAD^{tree}',
      'echo git',
      'git --version',
    ]) {
      expect(gitMutation(command), command).toBeUndefined()
    }
  })
})

describe('teammate lane guard', () => {
  it('denies shell Git mutations for shared and isolated lanes', () => {
    for (const policy of [{ kind: 'shared' }, { kind: 'isolated', writeScopes: ['src'] }] as const) {
      expect(laneGuardViolation(call('bash', { command: 'git commit -m x' }), policy))
        .toContain('git commit')
      expect(laneGuardViolation(call('pwsh', { command: 'git push' }), policy))
        .toContain('git push')
      expect(laneGuardViolation(call('bash', { command: 'git status' }), policy)).toBeUndefined()
      expect(laneGuardViolation(call('write', { file_path: 'a', content: 'x' }), policy)).toBeUndefined()
    }
  })

  it('denies file and self-modification tools only in a read-only lane', () => {
    const readOnly = { kind: 'read-only' } as const
    for (const name of ['write', 'edit', 'str_replace_editor', 'notebook_edit', 'cordis_define', 'cordis_run']) {
      expect(laneGuardViolation(call(name, {}), readOnly), name).toContain('read-only')
    }
    expect(laneGuardViolation(call('read', { file_path: 'a' }), readOnly)).toBeUndefined()
    expect(laneGuardViolation(call('bash', { command: 'git status' }), readOnly)).toBeUndefined()
  })

  it('ignores non-shell arguments without a command field', () => {
    expect(laneGuardViolation(call('bash', {}), { kind: 'shared' })).toBeUndefined()
    expect(laneGuardViolation(call('bash', { command: 42 }), { kind: 'shared' })).toBeUndefined()
    expect(laneGuardViolation(call('read', { file_path: 'git commit' }), { kind: 'shared' })).toBeUndefined()
  })
})
