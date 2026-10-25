import { describe, expect, it } from 'vitest'
import { Semaphore } from '../src/semaphore.ts'

describe('Semaphore', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid capacity %s', (capacity) => {
    expect(() => new Semaphore(capacity)).toThrow('semaphore capacity must be an integer >= 1')
  })

  it('hands released slots to the oldest live waiter and makes release idempotent', async () => {
    const semaphore = new Semaphore(1)
    const first = await semaphore.acquire(new AbortController().signal)
    const second = semaphore.acquire(new AbortController().signal)
    const third = semaphore.acquire(new AbortController().signal)
    const order: string[] = []

    const secondHeld = second.then((release) => {
      order.push('second')
      return release
    })
    const thirdHeld = third.then((release) => {
      order.push('third')
      return release
    })
    first()
    first()
    const releaseSecond = await secondHeld
    releaseSecond()
    const releaseThird = await thirdHeld
    releaseThird()
    expect(order).toEqual(['second', 'third'])

    const final = await semaphore.acquire(new AbortController().signal)
    final()
  })

  it('removes an aborted waiter without losing or duplicating a slot', async () => {
    const semaphore = new Semaphore(1)
    const first = await semaphore.acquire(new AbortController().signal)
    const cancelled = new AbortController()
    const reason = new Error('stop waiting')
    const cancelledAcquire = semaphore.acquire(cancelled.signal)
    const nextAcquire = semaphore.acquire(new AbortController().signal)

    cancelled.abort(reason)
    await expect(cancelledAcquire).rejects.toBe(reason)
    first()
    const next = await nextAcquire
    next()
    const last = await semaphore.acquire(new AbortController().signal)
    last()
  })

  it('rejects pre-aborted acquisitions and wraps non-Error reasons', async () => {
    const semaphore = new Semaphore(1)
    const errorController = new AbortController()
    const reason = new Error('already stopped')
    errorController.abort(reason)
    await expect(semaphore.acquire(errorController.signal)).rejects.toBe(reason)

    const stringController = new AbortController()
    stringController.abort('string stop')
    await expect(semaphore.acquire(stringController.signal)).rejects.toThrow('string stop')
  })
})
