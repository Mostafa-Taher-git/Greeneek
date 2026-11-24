import { describe, expect, it, vi } from 'vitest'
import { frameStream } from '../src/frame-stream.ts'

describe('frameStream', () => {
  it('yields each queued frame and disposes the subscription on return', async () => {
    let push!: (frame: string | undefined) => void
    const dispose = vi.fn()
    const stream = frameStream<string | undefined>((attach) => { push = attach; return dispose }, new AbortController().signal)

    const first = stream.next()
    push(undefined)
    push('a')
    expect(await first).toEqual({ value: 'a', done: false })
    const second = stream.next()
    push('b')
    expect(await second).toEqual({ value: 'b', done: false })
    await stream.return(undefined)

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('ends on abort and wakes a waiting read', async () => {
    const controller = new AbortController()
    const dispose = vi.fn()
    const stream = frameStream<string>(() => dispose, controller.signal)
    const pending = stream.next()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    controller.abort()

    expect(await pending).toEqual({ value: undefined, done: true })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('ends once the source reports it is gone', async () => {
    const stream = frameStream<string>(() => () => {}, new AbortController().signal, () => false)
    expect(await stream.next()).toEqual({ value: undefined, done: true })
  })
})
