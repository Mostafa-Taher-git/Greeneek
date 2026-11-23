import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { DeepAgentService, DEEP_AGENT_CHANGED, defaultDeepAgentDatabase } from '../src/index.ts'

const dirs: string[] = []
const services: DeepAgentService[] = []
function boot(): { ctx: Context; service: DeepAgentService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-runtime-'))
  dirs.push(dir)
  const ctx = new Context()
  const service = new DeepAgentService(ctx, { database: join(dir, 'deep-agent.sqlite') })
  services.push(service)
  return { ctx, service, dir }
}
afterEach(() => {
  for (const service of services.splice(0)) service.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('runtime', () => {
  it('reports real state from durable storage', () => {
    const { service } = boot()
    const state = service.state()
    expect(state.configured).toBe(false)
    expect(state.mode).toBe('observe')
    expect(state.counts.tickets).toBe(0)
    expect(state.counts.triggers).toBe(0)
    expect(state.policyVersion).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns empty operational lists with no fabricated data', () => {
    const { service } = boot()
    expect(service.tickets()).toEqual([])
    expect(service.decisions()).toEqual([])
    expect(service.triggers()).toEqual([])
  })

  it('refuses to stop an unknown Ticket', () => {
    const { service } = boot()
    expect(() => { service.stopTicket({ ticketId: 'missing' }) }).toThrow()
  })

  it('exposes the configured capacity and database path', () => {
    const { service, dir } = boot()
    expect(service.maxWorkers()).toBe(3)
    expect(service.databasePath()).toBe(join(dir, 'deep-agent.sqlite'))
  })

  it('declares the change event and default database location', () => {
    expect(DEEP_AGENT_CHANGED).toBe('deep-agent/changed')
    expect(defaultDeepAgentDatabase()).toMatch(/deep-agent[\\/]orchestrator\.sqlite$/)
  })
})
