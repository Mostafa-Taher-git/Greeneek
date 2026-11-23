import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@greeneek/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { bootProductionProfile } from '../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import type { DecisionInput, TriggerInput } from '../src/types.ts'

const mockAdapter = pathToFileURL(fileURLToPath(new URL('../../../test-support/loader-smoke/tests/fixtures/cli-mock-llm.ts', import.meta.url))).href
let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  if (ctx !== undefined) await ctx.fiber.dispose()
  ctx = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

async function bootDeepAgent(): Promise<Context> {
  root = mkdtempSync(join(tmpdir(), 'deep-agent-e2e-'))
  const slash = (value: string): string => value.replaceAll('\\', '/')
  const patch = join(root, 'deep-agent.patch.yml')
  writeFileSync(patch, [
    '- id: agent-default-model',
    '  config:',
    '    provider: cli-mock',
    '    model: cli-mock',
    '- id: headless-startup',
    '  disabled: true',
    '- id: headless-runner',
    '  disabled: true',
    '- id: agent-loop',
    '  config:',
    '    agents:',
    '      - id: main',
    '        provider: cli-mock',
    '        model: cli-mock',
    `        cwd: '${slash(root)}'`,
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: '${slash(join(root, '.sessions'))}'`,
    '- id: deep-agent',
    '  config:',
    '    policy:',
    '      mode: observe',
    '      rules:',
    '        - id: copy',
    "          name: 'Copy fixes'",
    '          enabled: true',
    "          instruction: 'Explicit requests to correct wording'",
    '      sources:',
    '        manual:',
    '          allowed:',
    '            - id: operator',
    `    database: '${slash(join(root, 'deep-agent.sqlite'))}'`,
    `    workerRootDirectory: '${slash(join(root, 'work'))}'`,
    '    maxWorkers: 2',
    '    assessmentTimeoutMs: 60000',
    '- insert:',
    '    - id: cli-mock-llm',
    `      name: '${slash(mockAdapter)}'`,
    '',
  ].join('\n'))
  ctx = await bootProductionProfile({
    binName: 'deep-agent-e2e',
    profile: 'headless',
    overlayPaths: [patch],
  })
  return ctx
}

describe('Deep-agent real lifecycle', () => {
  it('drives a Trigger through assessment into a Ticket with real durable state', async () => {
    const context = await bootDeepAgent()
    const service = context.get('deepAgent') as unknown as {
      receive: (request: TriggerInput) => string
      evaluateDue: () => number
      decide: (request: DecisionInput) => string
      state: () => { counts: Record<string, number>; lastError?: string }
      workerCapacityState: () => { used: number; free: number }
      routerSessionId: () => string
      tickets: () => readonly { id: string; title: string; stage: string }[]
      triggers: () => readonly { id: string; evalId?: string }[]
    }

    const agents = context.get('agents') as unknown as {
      list(): Array<{ id: string; session: { snapshotEvents(): readonly { type: string; data?: unknown }[] } }>
    }

    expect(service.receive({
      id: 'manual-1', source: 'manual',
      threads: [{ source: 'manual', id: 'thread-1' }],
      actor: { source: 'manual', id: 'operator' },
      human: true, addressed: 'mention',
      at: new Date().toISOString(), text: 'Please fix the build',
    })).toBe('received')

    expect(service.receive({
      id: 'manual-1', source: 'manual',
      threads: [{ source: 'manual', id: 'thread-1' }],
      actor: { source: 'manual', id: 'operator' },
      human: true, addressed: 'mention',
      at: new Date().toISOString(), text: 'Please fix the build',
    })).toBe('duplicate')

    service.evaluateDue()
    const trigger = service.triggers()[0]
    expect(trigger?.id).toBe('manual-1')
    expect(trigger?.evalId).toBeDefined()

    const decisionId = service.decide({
      triggerId: 'manual-1',
      ...(trigger?.evalId === undefined ? {} : { evalId: trigger.evalId }),
      accept: true, reason: 'operator accepted', matchedRules: ['copy'],
    })
    expect(decisionId).toMatch(/^[0-9a-f]{32}$/)

    const tickets = service.tickets()
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({ title: 'Please fix the build' })
    expect(service.state().counts.tickets).toBe(1)

    const findWorker = (): { id: string; session: { snapshotEvents(): readonly { type: string; data?: unknown }[] } } | undefined =>
      agents.list().find(agent => agent.session.snapshotEvents().some(event =>
        JSON.stringify(event).includes('Ticket: Please fix the build')))
    const deadline = Date.now() + 30_000
    let worker = findWorker()
    while (worker === undefined && Date.now() < deadline) {
      await new Promise((resolve) => { setTimeout(resolve, 100) })
      worker = findWorker()
    }
    expect(worker).toBeDefined()
    expect(worker?.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(true)
    const turnDeadline = Date.now() + 20_000
    while (worker?.session.snapshotEvents().some(event => event.type === 'turn/end') !== true && Date.now() < turnDeadline) {
      await new Promise((resolve) => { setTimeout(resolve, 100) })
      worker = findWorker()
    }
    expect(worker?.session.snapshotEvents().some(event => event.type === 'turn/end')).toBe(true)
  }, 120_000)
})
