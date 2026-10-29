import { describe, expect, it } from 'vitest'
import {
  parseDelegationRuns,
  parseDelegationTasks,
  summarizeDelegation,
  type DelegationRun,
} from './benchmark-delegation.ts'

const TASKS = parseDelegationTasks({
  version: 1,
  tasks: [
    { id: 'one', description: 'first', prompt: 'do one', evaluation: { kind: 'file-exists', path: 'a.txt' } },
    { id: 'two', description: 'second', prompt: 'do two', evaluation: { kind: 'answer-contains', text: 'answer' } },
  ],
})

/** One supplied run with explicit values. */
function run(overrides: Partial<DelegationRun> & Pick<DelegationRun, 'taskId' | 'mode'>): DelegationRun {
  return {
    wallTimeMs: 1_000,
    inputTokens: 100,
    outputTokens: 20,
    passed: true,
    ...overrides,
  }
}

describe('delegation benchmark scaffold', () => {
  it('validates the fixed task contract', () => {
    expect(TASKS.map(task => task.id)).toEqual(['one', 'two'])
    expect(() => parseDelegationTasks({ version: 2, tasks: [] })).toThrow('version 1')
    expect(() => parseDelegationTasks({ version: 1, tasks: [] })).toThrow('non-empty')
    expect(() => parseDelegationTasks({
      version: 1,
      tasks: [
        { id: 'same', description: 'a', prompt: 'a', evaluation: { kind: 'answer-contains', text: 'a' } },
        { id: 'same', description: 'b', prompt: 'b', evaluation: { kind: 'answer-contains', text: 'b' } },
      ],
    })).toThrow('duplicate')
    expect(() => parseDelegationTasks({
      version: 1,
      tasks: [{ id: 'bad', description: 'a', prompt: 'a', evaluation: { kind: 'file-contains', text: 'x' } }],
    })).toThrow('evaluation path')
    expect(() => parseDelegationTasks({
      version: 1,
      tasks: [{ id: 'bad', description: 'a', prompt: 'a', evaluation: { kind: 'other', text: 'x' } }],
    })).toThrow('evaluation kind')
  })

  it('validates supplied runs against the fixed tasks', () => {
    expect(parseDelegationRuns({ version: 1, runs: [run({ taskId: 'one', mode: 'sequential' })] }, TASKS))
      .toHaveLength(1)
    expect(() => parseDelegationRuns({ version: 1, runs: [] }, TASKS)).not.toThrow()
    expect(() => parseDelegationRuns({ version: 1, runs: [run({ taskId: 'absent', mode: 'maestro' })] }, TASKS))
      .toThrow('unknown task')
    expect(() => parseDelegationRuns({
      version: 1,
      runs: [run({ taskId: 'one', mode: 'sequential' }), run({ taskId: 'one', mode: 'sequential' })],
    }, TASKS)).toThrow('repeat')
    expect(() => parseDelegationRuns({
      version: 1,
      runs: [{ ...run({ taskId: 'one', mode: 'maestro' }), wallTimeMs: -1 }],
    }, TASKS)).toThrow('wallTimeMs')
    expect(() => parseDelegationRuns({
      version: 1,
      runs: [{ ...run({ taskId: 'one', mode: 'maestro' }), inputTokens: 1.5 }],
    }, TASKS)).toThrow('inputTokens')
    expect(() => parseDelegationRuns({
      version: 1,
      runs: [{ ...run({ taskId: 'one', mode: 'maestro' }), costUsd: 0.1 }],
    }, TASKS)).not.toThrow()
  })

  it('never reports a verdict without complete two-mode coverage', () => {
    const report = summarizeDelegation(TASKS, [run({ taskId: 'one', mode: 'sequential' })])

    expect(report.verdict).toBeNull()
    expect(report.coverage).toEqual({ tasks: 2, sequentialTasks: 1, maestroTasks: 0, complete: false })
    expect(report.summary.sequential).toMatchObject({ runs: 1, passed: 1, passRate: 1, wallTimeMs: 1_000, tokens: 120 })
    expect(report.summary.maestro).toMatchObject({ runs: 0, passed: 0, passRate: null, wallTimeMs: 0, tokens: 0 })
    expect(report.note).toContain('No complete comparison')
  })

  it('compares pass rate before wall time with complete coverage', () => {
    const sequential = [
      run({ taskId: 'one', mode: 'sequential', passed: true }),
      run({ taskId: 'two', mode: 'sequential', passed: false }),
    ]
    const maestro = [
      run({ taskId: 'one', mode: 'maestro', passed: true, wallTimeMs: 2_000 }),
      run({ taskId: 'two', mode: 'maestro', passed: true, wallTimeMs: 2_000 }),
    ]
    const better = summarizeDelegation(TASKS, [...sequential, ...maestro])
    expect(better.coverage.complete).toBe(true)
    expect(better.verdict).toBe('maestro')
    expect(better.summary.sequential.costUsd).toBeNull()
    expect(better.summary.maestro.costUsd).toBeNull()

    const equalRateFaster = summarizeDelegation(TASKS, [
      run({ taskId: 'one', mode: 'sequential', wallTimeMs: 1_000 }),
      run({ taskId: 'two', mode: 'sequential', wallTimeMs: 1_000 }),
      run({ taskId: 'one', mode: 'maestro', wallTimeMs: 3_000 }),
      run({ taskId: 'two', mode: 'maestro', wallTimeMs: 3_000 }),
    ])
    expect(equalRateFaster.verdict).toBe('sequential')

    const tie = summarizeDelegation(TASKS, [
      run({ taskId: 'one', mode: 'sequential' }),
      run({ taskId: 'two', mode: 'sequential' }),
      run({ taskId: 'one', mode: 'maestro' }),
      run({ taskId: 'two', mode: 'maestro' }),
    ])
    expect(tie.verdict).toBe('tie')
  })

  it('sums known costs only when every run reports one', () => {
    const complete = summarizeDelegation(TASKS, [
      run({ taskId: 'one', mode: 'sequential', costUsd: 0.25 }),
      run({ taskId: 'two', mode: 'sequential', costUsd: 0.75 }),
      run({ taskId: 'one', mode: 'maestro' }),
      run({ taskId: 'two', mode: 'maestro' }),
    ])
    expect(complete.summary.sequential.costUsd).toBe(1)
    expect(complete.summary.maestro.costUsd).toBeNull()
  })
})
