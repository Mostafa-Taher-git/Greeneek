import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import AutomationService from '../src/index.ts'
import type { AutomationCreateRequest } from '../src/types.ts'

function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'gnk-automation-'))
  const ctx = new Context()
  const service = new AutomationService(ctx, { file: join(dir, 'tasks.json') })
  return { ctx, service, dir }
}

function create(overrides: Partial<AutomationCreateRequest> = {}): AutomationCreateRequest {
  return {
    title: 'Daily digest', prompt: 'Summarize my reading list',
    cwd: null, repeat: 'once',
    at: new Date(Date.now() + 3600_000).toISOString(),
    timeZone: null,
    ...overrides,
  }
}

describe('AutomationService', () => {
  it('creates, lists, pauses, runs and deletes a task', async () => {
    const { ctx, service, dir } = boot()
    expect(service.list().tasks).toEqual([])
    const task = service.create(create())
    expect(task.status).toBe('active')
    expect(service.list().tasks).toHaveLength(1)
    const paused = service.edit({ id: task.id, status: 'paused', expectedUpdatedAt: task.updatedAt })
    expect(paused.status).toBe('paused')
    const ran = service.run({ id: task.id })
    expect(ran.lastRunAt).toBeTruthy()
    expect(service.delete({ id: task.id }).tasks).toEqual([])
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses invalid input and stale edits', async () => {
    const { ctx, service, dir } = boot()
    expect(() => service.create(create({ title: '' }))).toThrow()
    const task = service.create(create())
    expect(() => service.edit({ id: task.id, status: 'paused', expectedUpdatedAt: 'stale' })).toThrow()
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
})
