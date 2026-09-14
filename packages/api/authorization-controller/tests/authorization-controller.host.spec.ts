import { describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import { credentialKey } from '@greeneek/gnk-credentials'
import AuthorizationService, {
  type AuthorizationFlow, type AuthorizationSession,
} from '@greeneek/gnk-authorization'
import { remoteErrorOf } from '@greeneek/gnk-typert-protocol'
import { AttemptRegistry, AuthorizationController, projectEntry } from '../src/authorization.ts'
import type { AuthorizationAttemptFrame } from '../src/types.ts'
import { MemoryCredentials } from './memory.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const WIRE = 'llm-pi-ai/openai-codex'

/** A composition with the record store, the seam, and the controller mounted. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  return ctx
}

/** A flow that commits `key` after one notice and one text prompt. */
function promptingFlow(
  ctx: Context,
  prompt: (session: AuthorizationSession) => Promise<string> = session =>
    session.prompt({ kind: 'text', message: 'Paste the code' }),
): AuthorizationFlow {
  return {
    key: KEY,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }, { id: 'api-key', label: 'Paste a key' }],
    async run(session) {
      session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start' })
      const code = await prompt(session)
      await ctx.credentials.modifyRecord(KEY, () =>
        Promise.resolve({ kind: 'grant', payload: { token: code } }))
    },
  }
}

/** A flow that commits `key` only after its request signal aborts. */
function abortCommittedFlow(ctx: Context): { flow: AuthorizationFlow; started: Promise<undefined> } {
  const started = Promise.withResolvers<undefined>()
  return {
    started: started.promise,
    flow: {
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        started.resolve(undefined)
        await new Promise<void>((resolve) => {
          session.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        await ctx.credentials.modifyRecord(KEY, () =>
          Promise.resolve({ kind: 'grant', payload: { token: 'late' } }))
      },
    },
  }
}

describe('AuthorizationController', () => {
  /**
   * Next attempt frame, re-typed: the iterator's TReturn is `any` by lib
   * definition, so every step funnels through here before its kind is read.
   */
  async function step(
    iterator: AsyncIterator<AuthorizationAttemptFrame>,
  ): Promise<AuthorizationAttemptFrame | undefined> {
    const next: IteratorResult<AuthorizationAttemptFrame, undefined> = await iterator.next()
    return next.done === true ? undefined : next.value
  }

  it('lists the registered flows as wire views', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow(promptingFlow(ctx))

    const listed = ctx.authorizationController.list()
    await expect(listed).resolves.toEqual([{
      key: WIRE,
      label: 'ChatGPT (Codex)',
      methods: [
        { id: 'oauth', label: 'Sign in with ChatGPT' },
        { id: 'api-key', label: 'Paste a key' },
      ],
      inFlight: false,
    }])
  })

  it('reports when no authorization seam is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AuthorizationController)

    let failure: unknown
    try {
      await ctx.authorizationController.list()
    } catch (error: unknown) {
      failure = error
    }
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/internal' })
  })

  it('refuses a key outside the record grammar', async () => {
    const ctx = await harness()

    for (const key of ['openai-codex', 'llm-pi-ai/', '/openai-codex', 'llm pi/ai']) {
      let failure: unknown
      try {
        ctx.authorizationController.answer(key, 'p1', { status: 'answered', value: 'x' })
      } catch (error) {
        failure = error
      }
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('streams an attempt end to end: notice, prompt, answer, settlement, record', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow(promptingFlow(ctx))
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const notice = await step(iterator)
    expect(notice).toEqual({
      kind: 'notice',
      notice: { message: 'Continue in your browser', url: 'https://auth.example/start' },
    })

    const prompt = await step(iterator)
    if (prompt?.kind !== 'prompt') throw new Error('expected a prompt frame')
    expect(prompt.prompt).toEqual({ kind: 'text', message: 'Paste the code' })

    ctx.authorizationController.answer(WIRE, prompt.promptId, { status: 'answered', value: 'the-code' })

    const settled = await step(iterator)
    expect(settled).toEqual({ kind: 'settled', status: 'authorized' })
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'the-code' } })
  })

  it('settles a declined prompt as cancelled', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow(promptingFlow(ctx))
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()
    await step(iterator)
    const prompt = await step(iterator)
    if (prompt?.kind !== 'prompt') throw new Error('expected a prompt frame')

    ctx.authorizationController.answer(WIRE, prompt.promptId, { status: 'declined' })

    const settled = await step(iterator)
    expect(settled).toEqual({ kind: 'settled', status: 'cancelled' })
    expect(await ctx.credentials.readRecord(KEY)).toBeUndefined()
  })

  it('discards a late rejection once the abort already failed the stream', async () => {
    const ctx = await harness()
    const started = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        started.resolve(undefined)
        await new Promise<void>((_, reject) => {
          session.signal.addEventListener('abort', () => {
            session.notify({ message: 'Withdrawing on abort' })
            reject(new Error('flow saw the abort'))
          }, { once: true })
        })
      },
    })
    const abort = new AbortController()
    const stream = ctx.authorizationController.attempt(WIRE, undefined, abort.signal)
    const iterator = stream[Symbol.asyncIterator]()
    await started.promise

    abort.abort(new Error('stop'))
    expect(await step(iterator)).toEqual({
      kind: 'notice',
      notice: { message: 'Withdrawing on abort' },
    })
    await expect(iterator.next()).rejects.toThrow('stop')
  })

  it('discards frames and settlement once an aborted attempt fails first', async () => {
    const ctx = await harness()
    const { flow, started } = abortCommittedFlow(ctx)
    ctx.authorization.registerFlow(flow)
    const abort = new AbortController()
    const stream = ctx.authorizationController.attempt(WIRE, undefined, abort.signal)
    const iterator = stream[Symbol.asyncIterator]()
    await started

    abort.abort(new Error('stop'))
    await expect(iterator.next()).rejects.toThrow('stop')
  })

  it('withdraws a prompt whose own signal aborts, and rejects the flow question', async () => {
    const ctx = await harness()
    const racer = new AbortController()
    const prompted = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow(promptingFlow(ctx, (session) => {
      prompted.resolve(undefined)
      // The flow races a typed code against a browser callback and retires the
      // losing prompt by aborting its own signal; the controller surfaces the
      // withdrawal to the page, and the flow still commits.
      return session.prompt({
        kind: 'text',
        message: 'Paste the code or wait for the callback',
        signal: racer.signal,
      }).catch(() => 'retired')
    }))
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()
    await prompted.promise
    let promptId: string | undefined
    for (;;) {
      const frame = await step(iterator)
      if (frame === undefined) throw new Error('the attempt ended before its prompt')
      if (frame.kind === 'prompt') {
        promptId = frame.promptId
        break
      }
    }

    racer.abort()

    const withdrawn = await step(iterator)
    expect(withdrawn).toEqual({ kind: 'prompt-withdrawn', promptId })
    const settled = await step(iterator)
    expect(settled).toEqual({ kind: 'settled', status: 'authorized' })
    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'retired' } })
  })

  it('ends the stream in error for a flow failure', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run() {
        throw new Error('provider refused the grant')
      },
    })
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/failed',
      details: { key: WIRE },
    })
  })

  it('ends the stream in error when no flow claims the key', async () => {
    const ctx = await harness()
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/no-flow',
      details: { key: WIRE },
    })
  })

  it('fails the stream when the flow resolves without committing', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run() {
        // Returns without writing the record: the seam reports NOT_COMMITTED.
      },
    })
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/failed',
      details: { key: WIRE },
    })
  })

  it('ignores an abort that lands after the settlement', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow(promptingFlow(ctx))
    const abort = new AbortController()
    const stream = ctx.authorizationController.attempt(WIRE, undefined, abort.signal)
    const iterator = stream[Symbol.asyncIterator]()

    await step(iterator)
    const prompt = await step(iterator)
    if (prompt?.kind !== 'prompt') throw new Error('expected a prompt frame')
    ctx.authorizationController.answer(WIRE, prompt.promptId, { status: 'answered', value: 'the-code' })
    expect(await step(iterator)).toEqual({ kind: 'settled', status: 'authorized' })

    abort.abort(new Error('too late'))
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('names the requested method when no flow claims the key', async () => {
    const ctx = await harness()
    const stream = ctx.authorizationController.attempt('nope/nothing', 'oauth', new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/no-flow',
      details: { key: 'nope/nothing', method: 'oauth' },
    })
  })

  it('refuses a method the flow does not offer', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow(promptingFlow(ctx))
    const stream = ctx.authorizationController.attempt(WIRE, 'nope', new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/no-flow',
      details: { key: WIRE, method: 'nope' },
    })
  })

  it('ends the stream in error for a non-error throw', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      run() {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- non-Error flow failure is the scenario.
        return Promise.reject('boom')
      },
    })
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/failed',
      details: { key: WIRE, message: 'boom' },
    })
  })

  it('runs the explicitly named method', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow(promptingFlow(ctx))
    const stream = ctx.authorizationController.attempt(WIRE, 'oauth', new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    await step(iterator)
    const prompt = await step(iterator)
    if (prompt?.kind !== 'prompt') throw new Error('expected a prompt frame')
    ctx.authorizationController.answer(WIRE, prompt.promptId, { status: 'answered', value: 'the-code' })

    const settled = await step(iterator)
    expect(settled).toEqual({ kind: 'settled', status: 'authorized' })
    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'the-code' } })
  })

  it('answers a select prompt and a placeholder secret prompt in one attempt', async () => {
    const ctx = await harness()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start', code: 'AB-12' })
        const account = await session.prompt({
          kind: 'select',
          message: 'Pick an account',
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta', description: 'Second workspace' },
          ],
        })
        const code = await session.prompt({ kind: 'secret', message: 'Device code', placeholder: 'Paste it' })
        await ctx.credentials.modifyRecord(KEY, () =>
          Promise.resolve({ kind: 'grant', payload: { token: `${account}/${code}` } }))
      },
    })
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()

    expect(await step(iterator)).toEqual({
      kind: 'notice',
      notice: { message: 'Continue in your browser', url: 'https://auth.example/start', code: 'AB-12' },
    })
    const select = await step(iterator)
    if (select?.kind !== 'prompt') throw new Error('expected a select frame')
    expect(select.prompt).toEqual({
      kind: 'select',
      message: 'Pick an account',
      options: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta', description: 'Second workspace' },
      ],
    })
    ctx.authorizationController.answer(WIRE, select.promptId, { status: 'answered', value: 'b' })
    const text = await step(iterator)
    if (text?.kind !== 'prompt') throw new Error('expected a secret frame')
    expect(text.prompt).toEqual({ kind: 'secret', message: 'Device code', placeholder: 'Paste it' })
    ctx.authorizationController.answer(WIRE, text.promptId, { status: 'answered', value: 'AB-12' })

    const settled = await step(iterator)
    expect(settled).toEqual({ kind: 'settled', status: 'authorized' })
    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'b/AB-12' } })
  })



  it('refuses a second attempt for a key already in flight', async () => {
    const ctx = await harness()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run() {
        await gate
        await ctx.credentials.modifyRecord(KEY, () =>
          Promise.resolve({ kind: 'grant', payload: { token: 'one' } }))
      },
    })
    const first = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const firstIterator = first[Symbol.asyncIterator]()
    const second = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const secondIterator = second[Symbol.asyncIterator]()

    const failure = await secondIterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'authorization/in-flight' })

    release?.()
    expect((await firstIterator.next()).value).toEqual({ kind: 'settled', status: 'authorized' })
  })

  it('cancels a running attempt through cancel()', async () => {
    const ctx = await harness()
    const started = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        started.resolve(undefined)
        await new Promise<void>((resolve) => {
          session.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        await ctx.credentials.modifyRecord(KEY, () =>
          Promise.resolve({ kind: 'grant', payload: { token: 'late' } }))
      },
    })
    const stream = ctx.authorizationController.attempt(WIRE, undefined, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()
    await started.promise

    ctx.authorizationController.cancel(WIRE)

    const settled = await iterator.next()
    expect(settled.value).toEqual({ kind: 'settled', status: 'cancelled' })
  })

  it('rejects an answer naming a prompt that is not in flight', async () => {
    const ctx = await harness()
    let failure: unknown
    try {
      ctx.authorizationController.answer(WIRE, 'p404', { status: 'answered', value: 'x' })
    } catch (error) {
      failure = error
    }
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/no-prompt',
      details: { key: WIRE, promptId: 'p404' },
    })
  })
})

describe('AttemptRegistry', () => {
  it('resolves one registered prompt once, then forgets it', async () => {
    const registry = new AttemptRegistry()
    const slot = Promise.withResolvers<string>()
    const promptId = registry.register('llm-pi-ai/anthropic', {
      resolve: slot.resolve,
      reject: slot.reject,
      view: { kind: 'text', message: 'Paste the code' },
    })

    registry.answer('llm-pi-ai/anthropic', promptId, { status: 'answered', value: 'ok' })
    await expect(slot.promise).resolves.toBe('ok')

    // The slot is withdrawn: a second answer (e.g. a retried wire frame) is refused.
    let failure: unknown
    try {
      registry.answer('llm-pi-ai/anthropic', promptId, { status: 'answered', value: 'again' })
    } catch (error) {
      failure = error
    }
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'authorization/no-prompt' })
  })
})

describe('projectEntry', () => {
  it('renders the branded key as its scope/id wire string', () => {
    expect(projectEntry({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      inFlight: false,
    })).toEqual({
      key: WIRE,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      inFlight: false,
    })
  })
})
