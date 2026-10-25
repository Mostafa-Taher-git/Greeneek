import { afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@greeneek/cordis'
import type { Agent } from '@greeneek/gnk-agent'
import TokenMeter from '@greeneek/gnk-token-meter'
import { Session, SessionId } from '@greeneek/gnk-session'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import SubagentRuntime from '@greeneek/gnk-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@greeneek/gnk-subagent'
import WaveRuntime from '../src/index.ts'
import type { WaveMemberRequest, WaveMemberSpec, WaveRequest, WaveRuntimeConfig } from '../src/types.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(async (ctx) => { await ctx.fiber.dispose() }))
  contexts.clear()
})

export type ControlledRun = SubagentRun & {
  readonly deferred: PromiseWithResolvers<SubagentResult>
  readonly dispose: Mock<() => Promise<void>>
}

/** Provider whose publication is immediate and whose result and disposal are test-controlled. */
export class ControlledProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: true,
    agentPreset: true,
  }
  readonly inheritsParentContext = false
  readonly requests: ResolvedSubagentStartRequest[] = []
  readonly runs: ControlledRun[] = []

  constructor(readonly name = 'controlled', readonly abortOutcome: 'resolve' | 'reject' = 'resolve') {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const deferred = Promise.withResolvers<SubagentResult>()
    const id = SessionId(`${this.name}-child-${this.runs.length}`)
    const dispose = vi.fn(async (): Promise<void> => {})
    const run: ControlledRun = { id, localAgent: undefined, result: deferred.promise, deferred, dispose }
    const onAbort = (): void => {
      if (this.abortOutcome === 'reject') {
        deferred.reject(new Error(`${this.name} rejected after abort`))
        return
      }
      deferred.resolve({ output: [], stopReason: 'aborted' })
    }
    if (request.signal.aborted) {
      onAbort()
    } else {
      request.signal.addEventListener('abort', onAbort, { once: true })
    }
    void deferred.promise.then(() => {
      request.signal.removeEventListener('abort', onAbort)
    })
    this.requests.push(request)
    this.runs.push(run)
    return Promise.resolve(run)
  }
}

export interface WaveHarness {
  readonly ctx: Context
  readonly waves: WaveRuntime
  readonly subagents: SubagentRuntime
  readonly provider: ControlledProvider
  readonly parent: Agent
  readonly waveFiber: { dispose(): Promise<void> }
  readonly tokenMeterFiber: { dispose(): Promise<void> } | undefined
}

/** Mount the real subagent registry, projection registry, and wave service. */
export async function setupWave(
  config: WaveRuntimeConfig = {},
  options: { readonly meter?: boolean; readonly parentId?: string } = {},
): Promise<WaveHarness> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  const tokenMeterFiber = options.meter === false ? undefined : await ctx.plugin(TokenMeter)
  const waveFiber = await ctx.plugin(WaveRuntime, config)
  const provider = new ControlledProvider()
  ctx.subagents.registerProvider(provider)
  const parent = fakeParent(options.parentId ?? 'wave-parent')
  return { ctx, waves: ctx.waves, subagents: ctx.subagents, provider, parent, waveFiber, tokenMeterFiber }
}

export function fakeParent(id: string): Agent {
  const session = Session.create(SessionId(id))
  return { id: session.id, session } as unknown as Agent
}

export function childAgent(run: SubagentRun): Agent {
  const session = Session.create(run.id)
  return { id: run.id, session } as unknown as Agent
}

export function member(
  request: Partial<WaveMemberRequest> = {},
  options: { readonly provider?: string; readonly role?: string } = {},
): WaveMemberSpec {
  return {
    provider: options.provider ?? 'controlled',
    ...options.role === undefined ? {} : { role: options.role },
    request: {
      prompt: [{ type: 'text', text: 'perform the member task' }],
      ...request,
    },
  }
}

export function waveRequest(parent: Agent, members: readonly WaveMemberSpec[], overrides: Partial<WaveRequest> = {}): WaveRequest {
  return { parent, label: 'test fleet', members, ...overrides }
}

export function completed(text = 'done', structured?: unknown): SubagentResult {
  return {
    output: [{ type: 'text', text }],
    ...structured === undefined ? {} : { structured },
    stopReason: 'completed',
  }
}

/** Drive the real waterfall with only the agent field relevant to wave metering. */
export function preStep(ctx: Context, agent: Agent): Promise<unknown> {
  return ctx.waterfall(
    'agent/pre-step',
    { agent, messages: [], turn: 0, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

export function usage(tokens: number) {
  return {
    totals: {
      uncachedInputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    last: null,
  }
}
