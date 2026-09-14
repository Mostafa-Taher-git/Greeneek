// @vitest-environment jsdom
/** Provider sign-in: row button, attempt dialog frames, and the operations binding. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@greeneek/schemastery'
import { bindSnapshotSelector, RemoteError } from '@greeneek/gnk-client-test-runtime'
import type {
  AuthorizationAnswer, AuthorizationAttemptFrame, AuthorizationEntryView, AuthorizationMethodView,
  SettingsNamespaceView,
} from '@greeneek/gnk-api-remotes/client'
import type { JsonValue } from '@greeneek/gnk-util-values'
import { ModelsSection, providerCopy, signInKeyFor } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { SignInDialog } from '../src/client/SignInDialog.tsx'
import { SettingsDescribeMirror } from '@greeneek/gnk-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function refused(message: string) {
  return { ok: false as const, error: new RemoteError('gateway/internal', message, {}) }
}

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
    baseURL: Schema.string(),
  })),
})

function piAiNamespace(userProviders: Record<string, JsonValue>): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value: { providers: userProviders },
    base: { providers: {} },
    user: { providers: userProviders },
    applies: 'live',
    secrets: [],
    revision: 3,
  }
}

const OPENAI_FLOW: AuthorizationEntryView = {
  key: 'llm-pi-ai/openai',
  label: 'OpenAI',
  methods: [{ id: 'oauth', label: 'OAuth' }],
  inFlight: false,
}

/** One scripted attempt stream: the test pushes frames, fails, or ends it. */
function controllableStream() {
  const queue: AuthorizationAttemptFrame[] = []
  const waiters: Array<() => void> = []
  let error: unknown
  let ended = false
  const wake = (): void => { waiters.shift()?.() }
  return {
    push(frame: AuthorizationAttemptFrame): void {
      queue.push(frame)
      wake()
    },
    fail(cause: unknown): void {
      error = cause
      ended = true
      wake()
    },
    end(): void {
      ended = true
      wake()
    },
    async *stream(): AsyncGenerator<AuthorizationAttemptFrame> {
      for (;;) {
        while (queue.length > 0) yield queue.shift() as AuthorizationAttemptFrame
        if (error !== undefined) throw error
        if (ended) return
        await new Promise<void>((resolve) => { waiters.push(resolve) })
      }
    },
  }
}

function scriptedFace(options: {
  userProviders?: Record<string, JsonValue>
  directory?: Array<{ provider: string; displayName: string }>
  flows?: readonly AuthorizationEntryView[]
  list?: ReturnType<typeof vi.fn>
  attempt?: ReturnType<typeof vi.fn>
  answer?: ReturnType<typeof vi.fn>
  cancel?: ReturnType<typeof vi.fn>
} = {}) {
  const userProviders = options.userProviders ?? {
    openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy.example/v1' },
  }
  const namespace = piAiNamespace(userProviders)
  const directory = options.directory ?? [{ provider: 'openai', displayName: 'OpenAI' }]
  const face = {
    llm: {
      listProviders: vi.fn(() => Promise.resolve(ok([{ id: 'openai', name: 'OpenAI' }]))),
      listConfigurableProviders: vi.fn(() => Promise.resolve(ok(directory.map(entry => ({
        provider: entry.provider,
        displayName: entry.displayName,
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', entry.provider],
      }))))),
      discoverModels: vi.fn(() => Promise.resolve(ok([]))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, namespaces: [namespace] }))),
      mutate: vi.fn(() => Promise.resolve(ok(namespace))),
    },
    credentials: {
      describe: vi.fn((refs: string[]) => Promise.resolve(ok(
        Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
      ))),
      set: vi.fn(() => Promise.resolve(ok(undefined))),
      unset: vi.fn(() => Promise.resolve(ok(undefined))),
    },
    authorization: {
      list: options.list ?? vi.fn(() => Promise.resolve(ok(options.flows ?? []))),
      attempt: options.attempt ?? vi.fn(() => (async function *() {})()),
      answer: options.answer ?? vi.fn(() => Promise.resolve(ok(undefined))),
      cancel: options.cancel ?? vi.fn(() => Promise.resolve(ok(undefined))),
    },
  }
  return face
}

type PageContext = ConstructorParameters<typeof ModelsSettingsStore>[0]

function ctxWith(face: object): PageContext {
  return { remote: face } as unknown as PageContext
}

function operationsWith(face: object): ModelsOperations {
  return createModelsOperations(ctxWith(face))
}

describe('signInKeyFor', () => {
  it('addresses pi-ai routes under the adapter record scope', () => {
    expect(signInKeyFor('llm-pi-ai', 'openai-codex')).toBe('llm-pi-ai/openai-codex')
  })

  it('names no key outside the pi-ai namespace', () => {
    expect(signInKeyFor('llm-greeneek', 'greeneek-official')).toBeUndefined()
  })
})

describe('sign-in operations', () => {
  it('lists the offered flows', async () => {
    const operations = operationsWith(scriptedFace({ flows: [OPENAI_FLOW] }))

    await expect(operations.listSignInFlows()).resolves.toEqual([OPENAI_FLOW])
  })

  it('lists nothing when the read is refused', async () => {
    const face = scriptedFace({ list: vi.fn(() => Promise.resolve(refused('no seam'))) })
    const operations = operationsWith(face)

    await expect(operations.listSignInFlows()).resolves.toEqual([])
  })

  it('delivers prompt answers and reports refusals', async () => {
    const answer: AuthorizationAnswer = { status: 'answered', value: 'code' }
    const operations = operationsWith(scriptedFace())

    await expect(operations.answerSignInPrompt('llm-pi-ai/openai', 'p1', answer)).resolves.toBeUndefined()
    const denied = operationsWith(scriptedFace({ answer: vi.fn(() => Promise.resolve(refused('gone'))) }))
    await expect(denied.answerSignInPrompt('llm-pi-ai/openai', 'p1', answer)).resolves.toBe('gone')
  })
})

/** Mount one dialog over a scripted attempt stream. */
function mountDialog(options: {
  operations: ModelsOperations
  methods?: readonly AuthorizationMethodView[]
  onClose?: (authorized: boolean) => void
}) {
  const onClose = options.onClose ?? vi.fn()
  const view = render(
    <SignInDialog
      flowKey={OPENAI_FLOW.key}
      flowLabel={OPENAI_FLOW.label}
      methods={options.methods ?? OPENAI_FLOW.methods}
      operations={options.operations}
      t={t}
      onClose={onClose}
    />,
  )
  return { ...view, onClose }
}

/** The dialog footer's Close/Cancel button (the header X shares the name). */
function footerClose(): HTMLButtonElement {
  const match = screen.getAllByRole('button', { name: en.close })
    .find(button => button.textContent === en.close)
  if (match === undefined) throw new Error('sign-in dialog footer Close not found')
  return match as HTMLButtonElement
}

/** Open the dialog's running attempt through its single method. */
async function startAttempt(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'OAuth' }))
  await screen.findByText(en.signInWorking)
}

describe('SignInDialog', () => {
  it('opens the attempt with the chosen method', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    const operations = operationsWith(face)
    mountDialog({ operations })

    await startAttempt()

    expect(face.authorization.attempt).toHaveBeenCalledOnce()
    const [key, method, signal] = face.authorization.attempt.mock.calls[0] as [string, string, AbortSignal]
    expect(key).toBe('llm-pi-ai/openai')
    expect(method).toBe('oauth')
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('renders notices with links and codes', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'notice', notice: { message: 'Open this page.' } })
    stream.push({ kind: 'notice', notice: { message: 'Enter the code.', url: 'https://auth.example', code: 'AB-12' } })

    await screen.findByText('Open this page.')
    await screen.findByText('Enter the code.')
    expect(screen.getByRole('link', { name: 'https://auth.example' }).getAttribute('href'))
      .toBe('https://auth.example')
  })

  it('answers a text prompt and clears it on acceptance', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'Device code', placeholder: 'Paste it' } })
    const field = await screen.findByPlaceholderText('Paste it')
    const submitDisabled = (): boolean =>
      screen.getByRole('button', { name: en.signInAnswer }).hasAttribute('disabled')
    expect(submitDisabled()).toBe(true)
    fireEvent.change(field, { target: { value: '  ' } })
    expect(submitDisabled()).toBe(true)
    fireEvent.change(field, { target: { value: 'AB-12' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))

    await waitFor(() => { expect(face.authorization.answer).toHaveBeenCalledOnce() })
    expect(face.authorization.answer).toHaveBeenCalledWith(
      'llm-pi-ai/openai', 'p1', { status: 'answered', value: 'AB-12' },
    )
    await waitFor(() => { expect(screen.queryByPlaceholderText('Paste it')).toBeNull() })
  })

  it('masks a secret prompt', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'secret', message: 'API secret' } })

    const field = await screen.findByLabelText('API secret')
    expect(field.getAttribute('type')).toBe('password')
  })

  it('answers a select prompt with the chosen option', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({
      kind: 'prompt',
      promptId: 'p1',
      prompt: {
        kind: 'select',
        message: 'Pick an account',
        options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
      },
    })
    const select = await screen.findByLabelText('Pick an account')
    fireEvent.change(select, { target: { value: 'b' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))

    await waitFor(() => {
      expect(face.authorization.answer).toHaveBeenCalledWith(
        'llm-pi-ai/openai', 'p1', { status: 'answered', value: 'b' },
      )
    })
  })

  it('answers an option-less select with an empty value', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'select', message: 'Pick', options: [] } })
    await screen.findByLabelText('Pick')
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))

    await waitFor(() => {
      expect(face.authorization.answer).toHaveBeenCalledWith(
        'llm-pi-ai/openai', 'p1', { status: 'answered', value: '' },
      )
    })
  })

  it('declines a prompt on request', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'Code' } })
    await screen.findByLabelText('Code')
    fireEvent.click(screen.getByRole('button', { name: en.signInDecline }))

    await waitFor(() => {
      expect(face.authorization.answer).toHaveBeenCalledWith(
        'llm-pi-ai/openai', 'p1', { status: 'declined' },
      )
    })
  })

  it('keeps the prompt when an answer is refused', async () => {
    const stream = controllableStream()
    const face = scriptedFace({
      attempt: vi.fn(() => stream.stream()),
      answer: vi.fn(() => Promise.resolve(refused('prompt gone'))),
    })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'Code' } })
    const field = await screen.findByLabelText('Code')
    fireEvent.change(field, { target: { value: 'AB-12' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))

    await screen.findByText('prompt gone')
    expect(screen.queryByLabelText('Code')).not.toBeNull()
  })

  it('sends one answer for a double submit', async () => {
    const stream = controllableStream()
    let resolveAnswer!: (value: { ok: true; value: undefined }) => void
    const face = scriptedFace({
      attempt: vi.fn(() => stream.stream()),
      answer: vi.fn(() => new Promise<{ ok: true; value: undefined }>((resolve) => { resolveAnswer = resolve })),
    })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'Code' } })
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'AB-12' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.signInAnswer }).hasAttribute('disabled')).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))
    expect(face.authorization.answer).toHaveBeenCalledOnce()
    resolveAnswer(ok(undefined))
    await waitFor(() => { expect(screen.queryByLabelText('Code')).toBeNull() })
  })

  it('keeps a newer prompt when an older answer lands late', async () => {
    const stream = controllableStream()
    let resolveAnswer!: (value: { ok: true; value: undefined }) => void
    const face = scriptedFace({
      attempt: vi.fn(() => stream.stream()),
      answer: vi.fn(() => new Promise<{ ok: true; value: undefined }>((resolve) => { resolveAnswer = resolve })),
    })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'First' } })
    fireEvent.change(await screen.findByLabelText('First'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))
    stream.push({ kind: 'prompt', promptId: 'p2', prompt: { kind: 'text', message: 'Second' } })
    await screen.findByLabelText('Second')
    resolveAnswer(ok(undefined))

    await waitFor(() => { expect(screen.queryByLabelText('Second')).not.toBeNull() })
  })

  it("stays quiet when a withdrawn prompt's answer lands late", async () => {
    const stream = controllableStream()
    let resolveAnswer!: (value: { ok: true; value: undefined }) => void
    const face = scriptedFace({
      attempt: vi.fn(() => stream.stream()),
      answer: vi.fn(() => new Promise<{ ok: true; value: undefined }>((resolve) => { resolveAnswer = resolve })),
    })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'First' } })
    fireEvent.change(await screen.findByLabelText('First'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))
    stream.push({ kind: 'prompt-withdrawn', promptId: 'p1' })
    await waitFor(() => { expect(screen.queryByLabelText('First')).toBeNull() })
    resolveAnswer(ok(undefined))

    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(screen.queryByLabelText('First')).toBeNull()
  })

  it('drops only the withdrawn prompt', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({ kind: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'First' } })
    await screen.findByLabelText('First')
    stream.push({ kind: 'prompt-withdrawn', promptId: 'p2' })
    expect(screen.queryByLabelText('First')).not.toBeNull()
    stream.push({ kind: 'prompt-withdrawn', promptId: 'p1' })
    await waitFor(() => { expect(screen.queryByLabelText('First')).toBeNull() })
  })

  it('reports an authorized settlement and closes authorized', async () => {
    const stream = controllableStream()
    const onClose = vi.fn()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face), onClose })

    await startAttempt()
    stream.push({ kind: 'settled', status: 'authorized' })
    await screen.findByText(en.signInAuthorized)
    fireEvent.click(footerClose())

    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('reports a cancelled settlement and closes unauthorized', async () => {
    const stream = controllableStream()
    const onClose = vi.fn()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face), onClose })

    await startAttempt()
    stream.push({ kind: 'settled', status: 'cancelled' })
    await screen.findByText(en.signInCancelled)
    fireEvent.click(footerClose())

    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('shows a stream failure', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.fail(new Error('flow exploded'))

    await screen.findByText('flow exploded')
  })

  it('shows a non-error stream failure', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.fail('boom')

    await screen.findByText('boom')
  })

  it('submits a select prompt with its first option by default', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    stream.push({
      kind: 'prompt',
      promptId: 'p1',
      prompt: {
        kind: 'select',
        message: 'Pick an account',
        options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
      },
    })
    await screen.findByLabelText('Pick an account')
    fireEvent.click(screen.getByRole('button', { name: en.signInAnswer }))

    await waitFor(() => {
      expect(face.authorization.answer).toHaveBeenCalledWith(
        'llm-pi-ai/openai', 'p1', { status: 'answered', value: 'a' },
      )
    })
  })

  it('closes the attempt from the header button', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    const onClose = vi.fn()
    mountDialog({ operations: operationsWith(face), onClose })

    await startAttempt()
    const header = screen.getAllByRole('button', { name: en.close })
      .find(button => button.textContent !== en.close)
    if (header === undefined) throw new Error('dialog header close not found')
    fireEvent.click(header)

    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('cancels an open attempt from the footer', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    const { onClose, unmount } = mountDialog({ operations: operationsWith(face) })

    await startAttempt()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))

    expect(onClose).toHaveBeenCalledWith(false)
    unmount()
  })

  it('ignores a late failure after unmount', async () => {
    const stream = controllableStream()
    const face = scriptedFace({ attempt: vi.fn(() => stream.stream()) })
    const view = render(
      <SignInDialog
        flowKey={OPENAI_FLOW.key}
        flowLabel={OPENAI_FLOW.label}
        methods={OPENAI_FLOW.methods}
        operations={operationsWith(face)}
        t={t}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }))
    await screen.findByText(en.signInWorking)
    view.unmount()
    stream.fail(new Error('too late'))
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  })
})

/** Mount the section over scripted directory, credentials, and flows. */
async function mountSection(options: {
  userProviders?: Record<string, JsonValue>
  directory?: Array<{ provider: string; displayName: string }>
  flows?: readonly AuthorizationEntryView[]
}) {
  const face = scriptedFace({
    ...(options.userProviders === undefined ? {} : { userProviders: options.userProviders }),
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    ...(options.flows === undefined ? {} : { flows: options.flows }),
  })
  const controller = new ModelsSettingsStore(
    ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
  await controller.load()
  const injected: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    operations: operationsWith(face),
    schema: settingsSchema,
    t,
    renderSlot: () => null,
  }
  render(<ModelsSection {...injected} />)
  return { controller, face }
}

describe('ModelsSection sign-in', () => {
  it('offers the button only on rows with a listed flow', async () => {
    await mountSection({
      userProviders: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
      },
      directory: [
        { provider: 'openai', displayName: 'OpenAI' },
        { provider: 'deepseek', displayName: 'DeepSeek' },
      ],
      flows: [OPENAI_FLOW],
    })

    expect(await screen.findByRole('button', { name: providerCopy(en.signInTitle, { provider: 'openai', displayName: 'OpenAI' }) })).not.toBeNull()
    expect(screen.queryByRole('button', { name: providerCopy(en.signInTitle, { provider: 'deepseek', displayName: 'DeepSeek' }) })).toBeNull()
  })

  it('offers no button when the seam lists nothing', async () => {
    await mountSection({ flows: [] })

    await screen.findByText('OpenAI')
    expect(screen.queryByRole('button', { name: providerCopy(en.signInTitle, { provider: 'openai', displayName: 'OpenAI' }) })).toBeNull()
  })

  it('opens the attempt dialog and reloads on an authorized close', async () => {
    const stream = controllableStream()
    const attempt = vi.fn(() => stream.stream())
    const face = scriptedFace({ flows: [OPENAI_FLOW], attempt })
    const controller = new ModelsSettingsStore(
      ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    const load = vi.spyOn(controller, 'load')
    render(
      <ModelsSection
        controller={controller}
        useSnapshot={bindSnapshotSelector(controller.store)}
        operations={operationsWith(face)}
        schema={settingsSchema}
        t={t}
        renderSlot={() => null}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: providerCopy(en.signInTitle, { provider: 'openai', displayName: 'OpenAI' }) }))
    fireEvent.click(await screen.findByRole('button', { name: 'OAuth' }))
    await screen.findByText(en.signInWorking)
    expect(attempt).toHaveBeenCalledOnce()
    stream.push({ kind: 'settled', status: 'authorized' })
    await screen.findByText(en.signInAuthorized)
    fireEvent.click(footerClose())

    await waitFor(() => { expect(load).toHaveBeenCalled() })
    expect(screen.queryByText(en.signInAuthorized)).toBeNull()
  })

  it('closes an uncompleted attempt without reloading', async () => {
    const stream = controllableStream()
    const attempt = vi.fn(() => stream.stream())
    const face = scriptedFace({ flows: [OPENAI_FLOW], attempt })
    const controller = new ModelsSettingsStore(
      ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    const load = vi.spyOn(controller, 'load')
    render(
      <ModelsSection
        controller={controller}
        useSnapshot={bindSnapshotSelector(controller.store)}
        operations={operationsWith(face)}
        schema={settingsSchema}
        t={t}
        renderSlot={() => null}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: providerCopy(en.signInTitle, { provider: 'openai', displayName: 'OpenAI' }) }))
    fireEvent.click(await screen.findByRole('button', { name: 'OAuth' }))
    await screen.findByText(en.signInWorking)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))

    expect(screen.queryByText(en.signInWorking)).toBeNull()
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(load).not.toHaveBeenCalled()
  })

  it('drops a flows answer that lands after unmount', async () => {
    let resolveList!: (value: { ok: true; value: readonly AuthorizationEntryView[] }) => void
    const face = scriptedFace({ list: vi.fn(() => new Promise((resolve) => { resolveList = resolve })) })
    const controller = new ModelsSettingsStore(
      ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    const view = render(
      <ModelsSection
        controller={controller}
        useSnapshot={bindSnapshotSelector(controller.store)}
        operations={operationsWith(face)}
        schema={settingsSchema}
        t={t}
        renderSlot={() => null}
      />,
    )
    view.unmount()
    resolveList(ok([OPENAI_FLOW]))
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  })
})
