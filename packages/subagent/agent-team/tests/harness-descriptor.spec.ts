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

describe('harnessDescriptorFromProvider', () => {
  it('advertises a static route as the only model and marks the provider ready when continuable', () => {
    expect(harnessDescriptorFromProvider(READY_PROVIDER)).toEqual({
      name: 'greeneek',
      state: 'ready',
      models: [{ id: 'kilo-auto/free' }],
      supportsAgentOptions: true,
      supportsContextFork: true,
    })
  })

  it('reports unknown models and one-shot state when a provider has no route or durable lane', () => {
    expect(harnessDescriptorFromProvider(ONE_SHOT_PROVIDER)).toEqual({
      name: 'spawn',
      state: 'one-shot',
      models: 'unknown',
      supportsAgentOptions: false,
      supportsContextFork: false,
    })
  })
})

describe('resolveHarnessSelection', () => {
  it('sends no override when both model and effort are default or absent', () => {
    const descriptor: HarnessDescriptor = {
      name: 'greeneek',
      state: 'ready',
      models: [{ id: 'kilo-auto/free', efforts: [{ id: 'high' }] }],
      supportsAgentOptions: true,
      supportsContextFork: true,
    }
    expect(resolveHarnessSelection(descriptor, { model: HARNESS_DEFAULT, reasoningEffort: HARNESS_DEFAULT })).toEqual({
      kind: 'selected',
      unverified: false,
    })
  })

  it('keeps a literal model id and marks it unverified when the catalog is unknown', () => {
    const descriptor: HarnessDescriptor = {
      name: 'codex',
      state: 'ready',
      models: 'unknown',
      supportsAgentOptions: true,
      supportsContextFork: false,
    }
    expect(resolveHarnessSelection(descriptor, { model: 'gpt-5', reasoningEffort: 'high' })).toEqual({
      kind: 'selected',
      model: 'gpt-5',
      reasoningEffort: 'high',
      unverified: true,
    })
  })

  it('refuses an unavailable Harness by name', () => {
    const descriptor: HarnessDescriptor = {
      name: 'kilo',
      state: 'unauthenticated',
      models: 'unknown',
      supportsAgentOptions: true,
      supportsContextFork: false,
    }
    expect(resolveHarnessSelection(descriptor, {})).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_UNAVAILABLE',
    })
  })

  it('refuses an override on a Harness without agent options', () => {
    const descriptor: HarnessDescriptor = {
      name: 'spawn',
      state: 'ready',
      models: 'unknown',
      supportsAgentOptions: false,
      supportsContextFork: false,
    }
    expect(resolveHarnessSelection(descriptor, { model: 'other' })).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_AGENT_OPTIONS_UNSUPPORTED',
    })
  })

  it('refuses a fork context when the Harness cannot seed parent turns', () => {
    const descriptor: HarnessDescriptor = {
      name: 'spawn',
      state: 'ready',
      models: 'unknown',
      supportsAgentOptions: true,
      supportsContextFork: false,
    }
    expect(resolveHarnessSelection(descriptor, { context: 'fork', model: HARNESS_DEFAULT })).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_CONTEXT_NOT_SUPPORTED',
    })
  })

  it('refuses a model the Harness did not advertise', () => {
    const descriptor: HarnessDescriptor = {
      name: 'greeneek',
      state: 'ready',
      models: [{ id: 'kilo-auto/free' }],
      supportsAgentOptions: true,
      supportsContextFork: true,
    }
    expect(resolveHarnessSelection(descriptor, { model: 'missing' })).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_MODEL_NOT_ADVERTISED',
    })
  })

  it('refuses an effort the advertised model does not support', () => {
    const descriptor: HarnessDescriptor = {
      name: 'greeneek',
      state: 'ready',
      models: [{ id: 'kilo-auto/free', efforts: [{ id: 'high' }] }],
      supportsAgentOptions: true,
      supportsContextFork: true,
    }
    expect(resolveHarnessSelection(descriptor, { model: 'kilo-auto/free', reasoningEffort: 'low' })).toMatchObject({
      kind: 'refused',
      code: 'HARNESS_EFFORT_NOT_SUPPORTED',
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
