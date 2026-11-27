import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { rendererCrashAction } from '../src/renderer-recovery.js'

describe('renderer crash recovery', () => {
  it('ignores a clean renderer exit', () => {
    const reloads = []
    assert.equal(rendererCrashAction({ reloads, reason: 'clean-exit', now: 1000 }), 'none')
    assert.deepEqual(reloads, [])
  })

  it('reloads a bounded number of crashes inside the window', () => {
    const reloads = []
    assert.equal(rendererCrashAction({ reloads, reason: 'crashed', now: 1000 }), 'reload')
    assert.equal(rendererCrashAction({ reloads, reason: 'crashed', now: 2000 }), 'reload')
    assert.equal(rendererCrashAction({ reloads, reason: 'crashed', now: 3000 }), 'dialog')
    assert.deepEqual(reloads, [1000, 2000])
  })

  it('forgets retries older than the window', () => {
    const reloads = [1000]
    assert.equal(rendererCrashAction({ reloads, reason: 'crashed', now: 1000 + 60_001 }), 'reload')
    assert.deepEqual(reloads, [61_001])
  })
})
