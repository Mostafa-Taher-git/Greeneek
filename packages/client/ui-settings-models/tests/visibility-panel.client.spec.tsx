// @vitest-environment jsdom
/** Model-visibility panel: per-model toggles persisted as hiddenModels. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@greeneek/schemastery'
import { bindSnapshotSelector, RemoteError } from '@greeneek/gnk-client-test-runtime'
import type { SettingsNamespaceView } from '@greeneek/gnk-api-remotes/client'
import type { JsonValue } from '@greeneek/gnk-util-values'
import { ModelsSection, providerCopy } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { SettingsDescribeMirror } from '@greeneek/gnk-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
const editModelsCopy = providerCopy(en.editModelsProvider, OPENAI_TARGET)

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
    baseURL: Schema.string(),
  })),
})

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function piAiNamespace(userProviders: Record<string, JsonValue>): SettingsNamespaceView {
  const providers = userProviders
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value: { providers },
    base: { providers: {} },
    user: { providers: userProviders },
    applies: 'live',
    secrets: [],
    revision: 3,
  }
}

function scriptedFace(options: {
  userProviders?: Record<string, JsonValue>
  discover?: ReturnType<typeof vi.fn>
  mutate?: ReturnType<typeof vi.fn>
} = {}) {
  const userProviders = options.userProviders ?? {
    openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy.example/v1' },
  }
  const namespace = piAiNamespace(userProviders)
  const discover = options.discover ?? vi.fn(() => Promise.resolve(ok([
    { id: 'gpt-a', name: 'GPT A' },
    { id: 'gpt-b', name: 'GPT B' },
  ])))
  const mutate = options.mutate ?? vi.fn(() => Promise.resolve(ok(namespace)))
  const face = {
    llm: {
      listProviders: vi.fn(() => Promise.resolve(ok([{ id: 'openai', name: 'openai' }]))),
      listConfigurableProviders: vi.fn(() => Promise.resolve(ok([{
        provider: 'openai',
        displayName: 'openai',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai'],
      }]))),
      discoverModels: discover,
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, namespaces: [namespace] }))),
      mutate,
    },
    credentials: {
      describe: vi.fn((refs: string[]) => Promise.resolve(ok(
        Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
      ))),
      set: vi.fn(() => Promise.resolve(ok(undefined))),
      unset: vi.fn(() => Promise.resolve(ok(undefined))),
    },
  }
  return { face, discover, mutate, namespace }
}

type PageContext = ConstructorParameters<typeof ModelsSettingsStore>[0]

const contexts = new WeakMap<object, PageContext>()
function ctxWith(face: object): PageContext {
  const existing = contexts.get(face)
  if (existing !== undefined) return existing
  const ctx = { remote: face } as unknown as PageContext
  contexts.set(face, ctx)
  return ctx
}

const operations = new WeakMap<object, ModelsOperations>()
function operationsWith(face: object): ModelsOperations {
  const existing = operations.get(face)
  if (existing !== undefined) return existing
  const bound = createModelsOperations(ctxWith(face))
  operations.set(face, bound)
  return bound
}

async function mountSection(options: Parameters<typeof scriptedFace>[0] = {}) {
  const scripted = scriptedFace(options)
  const controller = new ModelsSettingsStore(
    ctxWith(scripted.face), settingsSchema, new SettingsDescribeMirror(ctxWith(scripted.face)))
  await controller.load()
  const injected: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    operations: operationsWith(scripted.face),
    schema: settingsSchema,
    t,
    renderSlot: () => null,
  }
  render(<ModelsSection {...injected} />)
  return { ...scripted, controller }
}

/** Open the visibility panel of the openai row. */
async function openVisibility(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: editModelsCopy }))
  await screen.findByPlaceholderText(en.fetchSearch)
}

/** All model toggle switches currently rendered, in list order. */
function switches(): HTMLElement[] {
  return screen.getAllByRole('switch')
}

describe('model visibility panel', () => {
  it('lists the discovered models with their switches on', async () => {
    await mountSection()
    await openVisibility()
    expect(switches()).toHaveLength(2)
    expect(switches().map(switch_ => switch_.getAttribute('aria-checked'))).toEqual(['true', 'true'])
    expect(screen.getByText('GPT A')).toBeTruthy()
  })

  it('persists a toggled-off model as hiddenModels', async () => {
    const { mutate } = await mountSection()
    await openVisibility()
    fireEvent.click(switches()[0]!)
    expect(switches()[0]!.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    const [, ops] = mutate.mock.calls[0] as unknown as [string, Array<{ op: string; path: string[]; value: unknown }>]
    expect(ops).toEqual([{ op: 'set', path: ['providers', 'openai', 'hiddenModels'], value: ['gpt-a'] }])
  })

  it('starts a stored hide switched off and offers it even when undiscovered', async () => {
    await mountSection({
      userProviders: {
        openai: {
          apiKeyEnv: 'OPENAI_API_KEY',
          baseURL: 'https://proxy.example/v1',
          hiddenModels: ['gone'],
        },
      },
    })
    await openVisibility()
    const gone = screen.getByRole('switch', { name: 'gone' })
    expect(gone.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(gone)
    expect(gone.getAttribute('aria-checked')).toBe('true')
  })

  it('filters by the search field and restores through show-all', async () => {
    await mountSection()
    await openVisibility()
    fireEvent.change(screen.getByPlaceholderText(en.fetchSearch), { target: { value: 'gpt-b' } })
    expect(switches()).toHaveLength(1)
    fireEvent.click(switches()[0]!)
    expect(switches()[0]!.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByText(en.visibilityShowAll))
    expect(switches()[0]!.getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByPlaceholderText(en.fetchSearch), { target: { value: 'nothing-matches' } })
    expect(await screen.findByText(en.fetchNoMatches)).toBeTruthy()
  })

  it('reports a discovery refusal with a retry that recovers', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: new RemoteError('llm/model-discovery-rejected', 'endpoint refused', { settingsNs: 'llm-pi-ai' }),
      })
      .mockResolvedValueOnce(ok([{ id: 'gpt-a', name: 'GPT A' }]))
    await mountSection({ discover })
    fireEvent.click(screen.getByRole('button', { name: editModelsCopy }))
    expect(await screen.findByText('endpoint refused')).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await screen.findByPlaceholderText(en.fetchSearch)
    expect(switches()).toHaveLength(1)
  })
})
