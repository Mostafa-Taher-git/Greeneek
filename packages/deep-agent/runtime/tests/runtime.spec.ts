import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@greeneek/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { DeepAgentService, DEEP_AGENT_CHANGED, defaultDeepAgentDatabase } from '../src/index.ts'

const dirs: string[] = []
const services: DeepAgentService[] = []
function boot(config: ConstructorParameters<typeof DeepAgentService>[1] = {}): { ctx: Context; service: DeepAgentService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-runtime-'))
  dirs.push(dir)
  const ctx = new Context()
  const service = new DeepAgentService(ctx, { ...config, database: join(dir, 'deep-agent.sqlite') })
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

  it('reports a boot-configured adapter even with an empty policy source map', () => {
    const { service } = boot({
      discord: { guildId: 'guild-1', channels: ['channel-1'] },
    })
    expect(service.state().configured).toBe(true)
  })

  it('applies saved evaluation limits and worker capacity to the live runtime', () => {
    const { service } = boot()
    const before = service.settings()
    const beforeState = service.state()
    const saved = service.saveSettings({
      block: 'eval',
      value: { evalTimeoutSeconds: 45, maxWorkers: 7, paused: true },
      revision: before.revision,
    })
    expect(saved.paused).toBe(true)
    expect(service.maxWorkers()).toBe(7)
    expect(service.capacity().free).toBe(7)
    const state = service.state()
    expect(state.paused).toBe(true)
    // Evaluation timing and pause are operational, not authorization inputs;
    // changing them must not rewrite the mandate hash.
    expect(state.policyVersion).toBe(beforeState.policyVersion)
  })

  it('declares the change event and default database location', () => {
    expect(DEEP_AGENT_CHANGED).toBe('deep-agent/changed')
    expect(defaultDeepAgentDatabase()).toMatch(/deep-agent[\\/]orchestrator\.sqlite$/)
  })
})
