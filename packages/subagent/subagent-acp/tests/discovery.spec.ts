import { ReasoningEffortId } from '@greeneek/gnk-llm/brand'
import { describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@greeneek/gnk-agent'
import SubagentRuntime from '@greeneek/gnk-subagent'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import LocalSubprocessRuntime from '@greeneek/gnk-subprocess-local'
import type { InitializeResponse, NewSessionResponse, SessionConfigOption, SessionConfigSelectOptions } from '@agentclientprotocol/sdk'
import * as acp from '../src/index.ts'
import {
  acpConfigOption,
  acpSelectOptions,
  harnessCapabilitiesFromAcp,
  planAcpSelections,
} from '../src/acp-config.ts'

/**
 * Keyless tests for ACP capability discovery and model/effort selection. The
 * pure mapping runs in-process; the probe and the execution path drive the REAL
 * backend against the scripted mock ACP server over real stdio, so the tests
 * prove what the child was actually asked and what it actually received.
 */

const mockServer = fileURLToPath(new URL('./mock-acp-server.ts', import.meta.url))

const fakeParent = { id: 'parent', session: { header: { cwd: process.cwd() } } } as unknown as Agent

const MODEL_OPTION: SessionConfigOption = {
  type: 'select',
  id: 'model',
  name: 'Model',
  category: 'model',
  currentValue: 'alpha/fast',
  options: [
    { value: 'alpha/fast', name: 'Alpha Fast', description: 'cheap' },
    { value: 'alpha/deep', name: 'Alpha Deep' },
  ],
}

const EFFORT_OPTION: SessionConfigOption = {
  type: 'select',
  id: 'reasoning',
  name: 'Reasoning',
  category: 'thought_level',
  currentValue: 'medium',
  options: [
    {
      group: 'standard',
      name: 'Standard',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
      ],
    },
  ],
}

function initialize(overrides: Partial<InitializeResponse> = {}): InitializeResponse {
  return {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      sessionCapabilities: { fork: {}, resume: {}, list: {}, delete: {} },
    },
    authMethods: [{ id: 'login', name: 'Log in', description: 'browser' }],
    agentInfo: { name: 'mock-harness', version: '9.9.9' },
    ...overrides,
  }
}

function session(configOptions?: SessionConfigOption[] | null): NewSessionResponse {
  return {
    sessionId: 'session-1',
    ...configOptions === undefined ? {} : { configOptions },
  }
}

describe('acpSelectOptions', () => {
  it('flattens flat and grouped option lists into one entry per value', () => {
    expect(acpSelectOptions([
      { value: 'flat', name: 'Flat', description: 'one' },
      {
        group: 'g',
        name: 'Group',
        options: [{ value: 'grouped', name: 'Grouped', description: null }],
      },
    ] as SessionConfigSelectOptions)).toEqual([
      { value: 'flat', name: 'Flat', description: 'one' },
      { value: 'grouped', name: 'Grouped' },
    ])
  })
})

describe('acpConfigOption', () => {
  it('finds a select option by semantic category and ignores other categories', () => {
    expect(acpConfigOption([MODEL_OPTION, EFFORT_OPTION], 'thought_level')?.id).toBe('reasoning')
    expect(acpConfigOption([MODEL_OPTION], 'thought_level')).toBeUndefined()
    expect(acpConfigOption(null, 'model')).toBeUndefined()
  })
})

describe('harnessCapabilitiesFromAcp', () => {
  it('maps advertised models, per-model efforts, auth, sessions, prompt, and modes', () => {
    const capabilities = harnessCapabilitiesFromAcp(
      initialize(),
      session([
        MODEL_OPTION,
        EFFORT_OPTION,
        {
          type: 'select',
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          currentValue: 'ask',
          options: [{ value: 'ask', name: 'Ask' }],
        },
      ]),
      { harnessId: 'mock-harness', displayName: 'Mock Harness' },
    )

    expect(capabilities).toEqual({
      id: 'mock-harness',
      displayName: 'Mock Harness',
      models: [
        {
          id: 'alpha/fast',
          name: 'Alpha Fast',
          description: 'cheap',
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
          ],
          defaultEffort: 'medium',
        },
        {
          id: 'alpha/deep',
          name: 'Alpha Deep',
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
          ],
          defaultEffort: 'medium',
        },
      ],
      supportsAgentOptions: true,
      contextStrategies: ['fresh'],
      authMethods: [{ id: 'login', name: 'Log in', description: 'browser' }],
      sessions: { new: true, load: true, resume: true, fork: true, list: true, delete: true },
      prompt: { image: true, audio: false, embeddedContext: true },
      permissions: [{ id: 'ask', name: 'Ask' }],
      source: 'acp-session',
    })
  })

  it('reports unknown models and no overrides when the child advertises no options', () => {
    const capabilities = harnessCapabilitiesFromAcp(
      { protocolVersion: 1 },
      session(),
      { harnessId: 'bare' },
    )
    expect(capabilities).toEqual({
      id: 'bare',
      models: 'unknown',
      supportsAgentOptions: false,
      contextStrategies: ['fresh'],
      sessions: { new: true, load: false, resume: false, fork: false, list: false, delete: false },
      prompt: { image: false, audio: false, embeddedContext: false },
      source: 'acp-session',
    })
  })
})

/**
 * Narrow one selection plan to its refusal reason.
 * @param plan - the resolved plan.
 * @returns the refusal reason.
 */
function refusalReason(plan: ReturnType<typeof planAcpSelections>): string {
  if (plan.kind !== 'unsupported') throw new Error('expected the plan to refuse the requested settings')
  return plan.reason
}

describe('planAcpSelections', () => {
  it('selects the advertised model and effort by their option ids', () => {
    expect(planAcpSelections([MODEL_OPTION, EFFORT_OPTION], {
      model: 'alpha/deep',
      reasoningEffort: 'low',
    })).toEqual({
      kind: 'selected',
      selections: [
        { configId: 'model', value: 'alpha/deep' },
        { configId: 'reasoning', value: 'low' },
      ],
    })
  })

  it('sends no override when no option was requested', () => {
    expect(planAcpSelections([MODEL_OPTION], {})).toEqual({ kind: 'selected', selections: [] })
    expect(planAcpSelections(undefined, undefined)).toEqual({ kind: 'selected', selections: [] })
  })

  it('refuses a model the child did not advertise and names what it offered', () => {
    const reason = refusalReason(planAcpSelections([MODEL_OPTION], { model: 'beta/other' }))
    expect(reason).toContain('beta/other')
    expect(reason).toContain('alpha/fast, alpha/deep')
  })

  it('refuses model selection when the child advertises no model option', () => {
    expect(refusalReason(planAcpSelections([EFFORT_OPTION], { model: 'alpha/fast' })))
      .toContain('does not advertise model selection')
  })

  it('refuses effort selection when the child advertises no effort option', () => {
    expect(refusalReason(planAcpSelections([MODEL_OPTION], { reasoningEffort: 'high' })))
      .toContain('does not advertise reasoning-effort selection')
  })

  it('refuses an effort the child did not advertise', () => {
    const reason = refusalReason(planAcpSelections([MODEL_OPTION, EFFORT_OPTION], { reasoningEffort: 'max' }))
    expect(reason).toContain('"max"')
    expect(reason).toContain('low, medium')
  })
})

describe('ACP Harness discovery over real stdio', () => {
  async function setup(mockEnv: Record<string, string> = {}) {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(acp, {
      providerName: 'acp',
      harnessId: 'mock-harness',
      displayName: 'Mock Harness',
      command: process.execPath,
      args: [mockServer],
      permission: 'reject',
      env: mockEnv,
    })
    return ctx
  }

  it('probes the child handshake without sending a prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gnk-acp-discovery-'))
    const promptFile = join(dir, 'prompted')
    try {
      const ctx = await setup({
        MOCK_PROMPT_FILE: promptFile,
        MOCK_CONFIG_OPTIONS: JSON.stringify([MODEL_OPTION, EFFORT_OPTION]),
        MOCK_INITIALIZE_OVERRIDES: JSON.stringify({
          agentCapabilities: {
            promptCapabilities: { image: true, audio: false, embeddedContext: false },
          },
          authMethods: [{ id: 'login', name: 'Log in' }],
        }),
      })
      try {
        const provider = ctx.subagents.getProvider('acp')
        const capabilities = await provider?.discoverHarness?.({ signal: new AbortController().signal })
        expect(capabilities).toMatchObject({
          id: 'mock-harness',
          displayName: 'Mock Harness',
          supportsAgentOptions: true,
          source: 'acp-session',
        })
        expect(capabilities?.models).toHaveLength(2)
        expect(capabilities?.authMethods).toEqual([{ id: 'login', name: 'Log in' }])
        expect(capabilities?.prompt).toEqual({ image: true, audio: false, embeddedContext: false })
        expect(existsSync(promptFile)).toBe(false)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies the selected model and effort through session/set_config_option', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gnk-acp-select-'))
    const setConfigFile = join(dir, 'selections.jsonl')
    try {
      const ctx = await setup({
        MOCK_TEXT: 'configured answer',
        MOCK_CONFIG_OPTIONS: JSON.stringify([MODEL_OPTION, EFFORT_OPTION]),
        MOCK_SET_CONFIG_FILE: setConfigFile,
      })
      try {
        const run = await ctx.subagents.start('acp', {
          prompt: [{ type: 'text', text: 'p' }],
          parent: fakeParent,
          signal: new AbortController().signal,
          agentOptions: { model: 'alpha/deep', reasoningEffort: ReasoningEffortId('low') },
        })
        const result = await run.result
        expect(result.stopReason).toBe('completed')
        expect(result.output).toEqual([{ type: 'text', text: 'configured answer' }])
        await run.dispose()

        const selections = readFileSync(setConfigFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
          sessionId: string
          configId: string
          value: string
        })
        expect(selections).toEqual([
          { sessionId: expect.any(String) as unknown as string, configId: 'model', value: 'alpha/deep' },
          { sessionId: expect.any(String) as unknown as string, configId: 'reasoning', value: 'low' },
        ])
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses an unadvertised model before prompting and names it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gnk-acp-refuse-'))
    const promptFile = join(dir, 'prompted')
    try {
      const ctx = await setup({
        MOCK_PROMPT_FILE: promptFile,
        MOCK_CONFIG_OPTIONS: JSON.stringify([MODEL_OPTION]),
      })
      try {
        await expect(ctx.subagents.start('acp', {
          prompt: [{ type: 'text', text: 'p' }],
          parent: fakeParent,
          signal: new AbortController().signal,
          agentOptions: { model: 'beta/other' },
        })).rejects.toThrow(/capability/u)
        expect(existsSync(promptFile)).toBe(false)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses provider routing and token budgets by name', async () => {
    const ctx = await setup()
    try {
      await expect(ctx.subagents.start('acp', {
        prompt: [{ type: 'text', text: 'p' }],
        parent: fakeParent,
        signal: new AbortController().signal,
        agentOptions: { provider: 'kilo' },
      })).rejects.toThrow(/provider routing and maxTokens are unsupported/u)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
