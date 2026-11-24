/**
 * Queue frames pushed by a source and yield them until the caller aborts or the
 * source ends. The subscription is disposed once iteration stops, including
 * when the consumer breaks out of the loop.
 * @param subscribe - attaches `push` to the source and returns its disposer.
 * @param signal - caller lifetime; abort wakes a waiting read.
 * @param active - reports whether the source still exists (default always true).
 * @returns queued frames in push order.
 */
export async function* frameStream<T>(
  subscribe: (push: (frame: T) => void) => () => void,
  signal: AbortSignal,
  active: () => boolean = () => true,
): AsyncGenerator<T, void, unknown> {
  const queue: T[] = []
  let wake: (() => void) | undefined
  const push = (frame: T): void => {
    queue.push(frame)
    wake?.()
    wake = undefined
  }
  const dispose = subscribe(push)
  const onAbort = (): void => { wake?.(); wake = undefined }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      while (queue.length > 0) {
        const frame = queue.shift()
        if (frame !== undefined) yield frame
      }
      if (signal.aborted) return
      if (!active()) return
      await new Promise<void>((done) => { wake = done })
    }
  } finally {
    dispose()
    signal.removeEventListener('abort', onAbort)
  }
}
