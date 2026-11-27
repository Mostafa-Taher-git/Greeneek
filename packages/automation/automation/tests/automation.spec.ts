import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import LlmRuntime from '@greeneek/gnk-llm'
import SessionStore from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import SystemPrompt from '@greeneek/gnk-system-prompt'
import ToolRuntime from '@greeneek/gnk-tools'
import AgentRegistry from '@greeneek/gnk-agent'
import AgentDefaultModelConfig from '@greeneek/gnk-agent-default-model'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import AgentLoop from '@greeneek/gnk-agent-loop'
import { SessionId } from '@greeneek/gnk-session'
import AutomationService from '../src/index.ts'
import { AutomationRunId, type AutomationCreateRequest } from '../src/types.ts'
import { writeTasks } from '../src/store.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const dirs: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function boot(responses: string[] = ['complete'], pollIntervalMs = 30_000) {
  const dir = mkdtempSync(join(tmpdir(), 'gnk-automation-'))
  dirs.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root: join(dir, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(responses.map(response => response === 'hang' ? 'hang' : textResponse(response))))
  const service = new AutomationService(ctx, { file: join(dir, 'tasks.json'), pollIntervalMs })
  return { ctx, service, dir }
}

function create(overrides: Partial<AutomationCreateRequest> = {}): AutomationCreateRequest {
  return {
    title: 'Daily digest', prompt: 'Summarize my reading list',
    cwd: null, repeat: 'once',
    at: new Date(Date.now() + 3600_000).toISOString(),
    timeZone: 'UTC',
    ...overrides,
  }
}

describe('AutomationService', () => {
  it('creates, lists, pauses, runs the instruction, stores its result, and deletes', async () => {
    const { service } = await boot()
    expect(service.list().tasks).toEqual([])
    const task = service.create(create())
    expect(task.status).toBe('active')
    expect(service.list().tasks).toHaveLength(1)
    const paused = service.edit({ id: task.id, status: 'paused', expectedUpdatedAt: task.updatedAt })
    expect(paused.status).toBe('paused')
    const ran = await service.run({ id: task.id })
    expect(ran.status).toBe('ended')
    expect(ran.lastRunAt).toBeTruthy()
    expect(ran.history.at(-1)).toMatchObject({ status: 'succeeded', result: 'complete', error: null })
    expect(service.delete({ id: task.id }).tasks).toEqual([])
  })

  it('cancels active runs when the host unloads', async () => {
    const { ctx, service } = await boot(['hang'])
    const task = service.create(create())
    void service.run({ id: task.id }).catch(() => { /* unload owns the run */ })
    const running = Reflect.get(service, 'running') as Map<string, { controller: AbortController }>
    for (let attempt = 0; attempt < 50 && running.size === 0; attempt += 1) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    }
    expect(running.size).toBe(1)
    const controller = [...running.values()][0]?.controller
    await ctx.fiber.dispose()
    expect(controller?.signal.aborted).toBe(true)
    expect(running.size).toBe(0)
  })

  it('records provider failures in history and rejects the run Remote', async () => {
    const { service } = await boot([])
    const task = service.create(create())
    await expect(service.run({ id: task.id })).rejects.toThrow('MockAdapter: script exhausted')
    expect(service.list().tasks[0]?.history.at(-1)).toMatchObject({ status: 'failed', result: null })
  })

  it('reuses the task-owned persisted session for later executions', async () => {
    const { service } = await boot(['first result', 'second result'])
    const created = service.create(create({ repeat: 'daily' }))
    const first = await service.run({ id: created.id })
    const sessionId = first.target.sessionId
    expect(sessionId).toBeTruthy()
    const second = await service.run({ id: created.id })
    expect(second.target.sessionId).toBe(sessionId)
    expect(second.history.map(run => run.result)).toEqual(['first result', 'second result'])
    expect(second.history.map(run => run.sessionId)).toEqual([sessionId, sessionId])
  })

  it('rejects invalid input, invalid zones, missing tasks, and stale edits', async () => {
    const { service } = await boot()
    expect(() => service.create(create({ title: '' }))).toThrow()
    expect(() => service.create(create({ repeat: 'daily', at: null }))).toThrow()
    expect(() => service.create(create({ timeZone: 'Mars/Olympus' }))).toThrow()
    const task = service.create(create())
    expect(() => service.edit({ id: task.id, status: 'paused', expectedUpdatedAt: 'stale' })).toThrow()
    await expect(service.run({ id: 'missing' })).rejects.toThrow(/unknown task/)
  })

  it('runs due tasks through the scheduler and marks a one-shot task ended', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    const { service } = await boot()
    const task = service.create(create({ at: '2026-01-01T11:59:00.000Z' }))
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => { expect(service.list().tasks[0]?.history[0]?.status).toBe('succeeded') })
    expect(service.list().tasks[0]).toMatchObject({ id: task.id, status: 'ended' })
    expect(service.list().tasks[0]?.history).toHaveLength(1)
  })

  it('deduplicates a scheduled occurrence after the scheduler is reconstructed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:30:00Z'))
    const { service, dir } = await boot(['first'], 100)
    const task = service.create(create({ repeat: 'hourly', at: '2026-01-01T09:00:00.000Z' }))
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => { expect(service.list().tasks[0]?.history[0]?.status).toBe('succeeded') })
    expect(service.list().tasks[0]?.history[0]?.scheduledAt).toBe('2026-01-01T09:00:00.000Z')
    const restartContext = new Context()
    contexts.push(restartContext)
    const recovered = new AutomationService(restartContext, { file: join(dir, 'tasks.json'), pollIntervalMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect(recovered.list().tasks[0]?.history).toHaveLength(1)
    expect(recovered.list().tasks[0]?.id).toBe(task.id)
  })

  it('does not execute while paused and resumes through the scheduler', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    const { service } = await boot()
    const task = service.create(create({ repeat: 'hourly', at: '2026-01-01T11:00:00.000Z' }))
    service.edit({ id: task.id, status: 'paused', expectedUpdatedAt: task.updatedAt })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(service.list().tasks[0]?.history).toHaveLength(0)
    const paused = service.list().tasks[0]!
    service.edit({ id: task.id, status: 'active', expectedUpdatedAt: paused.updatedAt })
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => { expect(service.list().tasks[0]?.history[0]?.status).toBe('succeeded') })
    expect(service.list().tasks[0]?.history).toHaveLength(1)
  })

  it('marks persisted in-progress executions failed during restart recovery', async () => {
    const { service, dir } = await boot()
    const task = service.create(create())
    const startedAt = new Date().toISOString()
    writeTasks(join(dir, 'tasks.json'), [{
      ...task,
      history: [{
        id: AutomationRunId('run-interrupted'), scheduledAt: null,
        status: 'running', startedAt, completedAt: null,
        sessionId: SessionId('session-interrupted'), result: null, error: null,
      }],
    }])
    const restartContext = new Context()
    contexts.push(restartContext)
    const recovered = new AutomationService(restartContext, { file: join(dir, 'tasks.json') })
    const recoveredRun = recovered.list().tasks[0]?.history[0]
    expect(recoveredRun?.status).toBe('failed')
    expect(recoveredRun?.error).toBe('host stopped during execution')
    expect(typeof recoveredRun?.completedAt).toBe('string')
  })

  it('aborts and disposes an active agent when its task is deleted', async () => {
    const { ctx, service } = await boot(['hang'])
    const task = service.create(create())
    const execution = service.run({ id: task.id })
    await vi.waitFor(() => { expect(ctx.agents.list()).toHaveLength(1) })
    service.delete({ id: task.id })
    await expect(execution).rejects.toThrow(/deleted while running/)
    expect(ctx.agents.list()).toHaveLength(0)
  })
})
