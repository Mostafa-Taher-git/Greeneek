import { describe, expect, it } from 'vitest'
import {
  HARNESS_DEFAULT,
  harnessDescriptorFromProvider,
  resolveHarnessSelection,
  type HarnessDescriptor,
  type RegisteredProviderView,
} from '../src/harness-descriptor.ts'

const READY_PROVIDER: RegisteredProviderView = {
  name: 'greeneek',
  capabilities: { agentOptions: true },
  inheritsParentContext: true,
  agentRouteDefaults: { provider: 'kilo', model: 'kilo-auto/free' },
  prepareContinuable: () => undefined,
}

const ONE_SHOT_PROVIDER: RegisteredProviderView = {
  name: 'spawn',
  capabilities: { agentOptions: false },
  inheritsParentContext: false,
}

const DESCRIBED_PROVIDER: RegisteredProviderView = {
  name: 'opencode-work',
  capabilities: { agentOptions: true },
  inheritsParentContext: false,
  harnessCapabilities: {
    id: 'opencode',
    displayName: 'OpenCode',
    models: 'unknown',
    supportsAgentOptions: true,
    contextStrategies: ['fresh'],
    source: 'configuration',
  },
  discoverHarness: () => undefined,
}

/** Build a descriptor with only the fields one selection test cares about. */
function descriptor(overrides: Partial<HarnessDescriptor> = {}): HarnessDescriptor {
  return {
    harness: 'greeneek',
    displayName: 'Greeneek',
    connection: 'greeneek',
    name: 'greeneek',
    state: 'ready',
    models: [{ id: 'kilo-auto/free' }],
    supportsAgentOptions: true,
    supportsContextFork: true,
    contextStrategies: ['fresh', 'fork'],
    source: 'registration',
    canProbe: false,
    ...overrides,
  }
}

describe('harnessDescriptorFromProvider', () => {
  it('advertises a static route as the only model and marks the provider ready when continuable', () => {
    expect(harnessDescriptorFromProvider(READY_PROVIDER)).toEqual({
      harness: 'greeneek',
      displayName: 'greeneek',
      connection: 'greeneek',
      name: 'greeneek',
      state: 'ready',
      models: [{ id: 'kilo-auto/free' }],
      supportsAgentOptions: true,
      supportsContextFork: true,
      contextStrategies: ['fresh', 'fork'],
      source: 'registration',
      canProbe: false,
    })
  })

  it('reports unknown models and one-shot state when a provider has no route or durable lane', () => {
    expect(harnessDescriptorFromProvider(ONE_SHOT_PROVIDER)).toEqual({
      harness: 'spawn',
      displayName: 'spawn',
      connection: 'spawn',
      name: 'spawn',
      state: 'one-shot',
      models: 'unknown',
      supportsAgentOptions: false,
      supportsContextFork: false,
      contextStrategies: ['fresh'],
      source: 'registration',
      canProbe: false,
    })
  })

  it('groups a connection under the Harness identity it advertises and marks it probeable', () => {
    expect(harnessDescriptorFromProvider(DESCRIBED_PROVIDER)).toMatchObject({
      harness: 'opencode',
      displayName: 'OpenCode',
      connection: 'opencode-work',
      name: 'opencode-work',
      models: 'unknown',
      source: 'configuration',
      canProbe: true,
    })
  })

  it('lets a live probe replace the registration claims and records when it answered', () => {
    const entry = harnessDescriptorFromProvider(DESCRIBED_PROVIDER, {
      capabilities: {
        id: 'opencode',
        displayName: 'OpenCode',
        models: [{ id: 'anthropic/claude', efforts: [{ id: 'high' }] }],
        supportsAgentOptions: true,
        contextStrategies: ['fresh', 'fork'],
        sessions: { new: true, load: true, resume: false, fork: true, list: true, delete: false },
        prompt: { image: true, audio: false, embeddedContext: true },
        permissions: [{ id: 'build', name: 'Build' }],
        authMethods: [{ id: 'api-key', name: 'API key' }],
        version: '1.4.2',
        source: 'acp-session',
      },
      discoveredAt: '2026-11-06T10:00:00.000Z',
    })
    expect(entry).toMatchObject({
      harness: 'opencode',
      connection: 'opencode-work',
      models: [{ id: 'anthropic/claude', efforts: [{ id: 'high' }] }],
      supportsContextFork: false,
      contextStrategies: ['fresh'],
      sessions: { new: true, load: true, resume: false, fork: true, list: true, delete: false },
      prompt: { image: true, audio: false, embeddedContext: true },
      permissions: [{ id: 'build', name: 'Build' }],
      authMethods: [{ id: 'api-key', name: 'API key' }],
      version: '1.4.2',
      source: 'acp-session',
      discoveredAt: '2026-11-06T10:00:00.000Z',
    })
    expect(entry.discoveryError).toBeUndefined()
  })

  it.each([
    ['401 Unauthorized: invalid api key', 'unauthenticated'],
    ['spawn ENOENT', 'not-installed'],
    ['socket hang up', 'temporarily-unavailable'],
  ] as const)('classifies a failed probe (%s) as %s', (message, state) => {
    expect(harnessDescriptorFromProvider(DESCRIBED_PROVIDER, undefined, message)).toMatchObject({
      state,
      discoveryError: message,
    })
  })
})

describe('resolveHarnessSelection', () => {
  it('sends no override when both model and effort are default or absent', () => {
    const subject = descriptor({
      models: [{ id: 'kilo-auto/free', efforts: [{ id: 'high' }] }],
    })
    expect(resolveHarnessSelection(subject, { model: HARNESS_DEFAULT, reasoningEffort: HARNESS_DEFAULT })).toEqual({
      kind: 'selected',
      unverified: false,
    })
  })

  it('keeps a literal model id and marks it unverified when the catalog is unknown', () => {
    const subject = descriptor({ models: 'unknown', supportsContextFork: false })
    expect(resolveHarnessSelection(subject, { model: 'gpt-5', reasoningEffort: 'high' })).toEqual({
      kind: 'selected',
      model: 'gpt-5',
      reasoningEffort: 'high',
      unverified: true,
    })
  })

  it('keeps a literal effort and marks it unverified when the model advertises no levels', () => {
    expect(resolveHarnessSelection(descriptor(), { model: 'kilo-auto/free', reasoningEffort: 'high' })).toEqual({
      kind: 'selected',
      model: 'kilo-auto/free',
      reasoningEffort: 'high',
      unverified: true,
    })
  })

  it('refuses an unavailable Harness by name', () => {
    expect(resolveHarnessSelection(descriptor({ state: 'unauthenticated' }), {})).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_UNAVAILABLE',
      reason: 'harness "greeneek" is unauthenticated; refusing to launch a Fleet member',
    })
  })

  it('refuses an override on a Harness without agent options', () => {
    expect(resolveHarnessSelection(descriptor({ supportsAgentOptions: false }), { model: 'other' })).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_AGENT_OPTIONS_UNSUPPORTED',
    })
  })

  it('accepts a default model on a Harness without agent options', () => {
    expect(resolveHarnessSelection(descriptor({ supportsAgentOptions: false }), { model: HARNESS_DEFAULT }))
      .toEqual({ kind: 'selected', unverified: false })
  })

  it('refuses a fork context when the Harness cannot seed parent turns', () => {
    expect(resolveHarnessSelection(descriptor({ supportsContextFork: false }), {
      context: 'fork',
      model: HARNESS_DEFAULT,
    })).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_CONTEXT_NOT_SUPPORTED',
    })
  })

  it('refuses a model the Harness did not advertise', () => {
    expect(resolveHarnessSelection(descriptor(), { model: 'missing' })).toEqual({
      kind: 'refused',
      code: 'HARNESS_MODEL_NOT_ADVERTISED',
      reason: 'harness "greeneek" does not advertise model "missing"; available: kilo-auto/free',
    })
  })

  it('refuses an effort the advertised model does not support', () => {
    const subject = descriptor({ models: [{ id: 'kilo-auto/free', efforts: [{ id: 'high' }] }] })
    expect(resolveHarnessSelection(subject, { model: 'kilo-auto/free', reasoningEffort: 'low' })).toEqual({
      kind: 'refused',
      code: 'HARNESS_EFFORT_NOT_SUPPORTED',
      reason: 'harness "greeneek" model "kilo-auto/free" does not support effort "low"; available: high',
    })
  })

  it('accepts an advertised effort and stays verified', () => {
    const subject = descriptor({ models: [{ id: 'kilo-auto/free', efforts: [{ id: 'high' }] }] })
    expect(resolveHarnessSelection(subject, { model: 'kilo-auto/free', reasoningEffort: 'high' })).toEqual({
      kind: 'selected',
      model: 'kilo-auto/free',
      reasoningEffort: 'high',
      unverified: false,
    })
  })

  it('reports unverified when no descriptor is known', () => {
    expect(resolveHarnessSelection(undefined, { model: 'gpt-5' })).toEqual({
      kind: 'selected',
      model: 'gpt-5',
      unverified: true,
    })
  })
})
