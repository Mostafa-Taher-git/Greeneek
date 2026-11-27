import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import { SettingsStore } from '../src/settings.ts'

const dirs: string[] = []
const stores: DeepAgentStore[] = []
function settings() {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agent-settings-'))
  dirs.push(dir)
  const store = new DeepAgentStore(join(dir, 'deep-agent.sqlite'))
  stores.push(store)
  return new SettingsStore(store)
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('settings persistence', () => {
  it('starts from a versioned default document', () => {
    const current = settings().settings()
    expect(current.revision).toBe(0)
    expect(current.mode).toBe('observe')
    expect(current.maxWorkers).toBe(3)
  })

  it('refuses a stale revision and saves a new one', () => {
    const store = settings()
    expect(() => store.save('pause', { paused: true }, 5)).toThrow(/stale/)
    const updated = store.save('pause', { paused: true }, 0)
    expect(updated.revision).toBe(1)
    expect(updated.paused).toBe(true)
    expect(store.settings()).toEqual(updated)
  })

  it('saves policy, eval, executor and source blocks independently', () => {
    const store = settings()
    const one = store.save('policy', {
      rules: [{ id: 'copy', name: 'Copy fixes', enabled: false, instruction: 'x' }],
      mode: 'auto',
    }, 0)
    const two = store.save('eval', { evalTimeoutSeconds: 30, maxWorkers: 5, paused: true }, one.revision)
    const three = store.save('executor', { workerDirectory: '/tmp/work', prepareCommand: '', blockedCommands: ['rm'] }, two.revision)
    const four = store.save('sources', { sources: { github: { allowed: [{ id: 'alice' }], admission: {} } } }, three.revision)
    expect(four).toMatchObject({ mode: 'auto', maxWorkers: 5, workerDirectory: '/tmp/work', blockedCommands: ['rm'] })
    expect(four.sources.github?.allowed[0]?.id).toBe('alice')
    expect(four.paused).toBe(true)
  })
})

describe('prompt versions', () => {
  it('exposes built-ins and saves immutable versions', () => {
    const store = settings()
    const initial = store.prompts()
    expect(initial.map(item => item.name)).toEqual(['admission', 'router', 'worker'])
    expect(initial.every(item => item.builtIn)).toBe(true)
    const first = store.savePrompt('router', 'You are a coordinator.')
    expect(first.version).toBe(1)
    expect(first.builtIn).toBe(false)
    const second = store.savePrompt('router', 'You are a careful coordinator.')
    expect(second.version).toBe(2)
    expect(store.promptHistory('router').map(item => item.version)).toEqual([2, 1])
    expect(store.prompts().find(item => item.name === 'router')?.text).toBe(second.text)
  })

  it('restores a built-in prompt as a new version', () => {
    const store = settings()
    store.savePrompt('worker', 'custom')
    const reset = store.resetPrompt('worker')
    expect(reset.builtIn).toBe(false)
    expect(reset.text).toContain('Deep-agent Worker')
    expect(store.promptHistory('worker')).toHaveLength(2)
  })

  it('refuses unknown prompts and empty text', () => {
    const store = settings()
    expect(() => store.savePrompt('unknown', 'x')).toThrow(/unknown prompt/)
    expect(() => store.savePrompt('router', '  ')).toThrow(/cannot be empty/)
  })
})
