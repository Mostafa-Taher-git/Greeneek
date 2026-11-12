import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  describeMissingInterface,
  diagnosticReport,
  interfaceFailureScript,
  rendererDiagnostic,
  waitForInterface,
} from '../src/interface-watch.js'

describe('renderer diagnostics', () => {
  it('reads an Electron console event into a diagnostic line', () => {
    assert.deepEqual(
      rendererDiagnostic({ level: 'error', message: 'Failed to load plugins' }),
      { level: 'error', message: 'Failed to load plugins' },
    )
  })

  it('ignores an event without a message', () => {
    assert.equal(rendererDiagnostic({ level: 'info' }), undefined)
    assert.equal(rendererDiagnostic('not an event'), undefined)
  })

  it('reports the collected diagnostics as lines', () => {
    const report = diagnosticReport([
      { level: 'error', message: 'missing asset' },
      { level: 'warning', message: 'slow' },
    ])
    assert.deepEqual(report, ['[error] missing asset', '[warning] slow'])
  })
})

describe('describeMissingInterface', () => {
  it('names the missing assets when the service does not serve the interface', async () => {
    const reason = await describeMissingInterface('http://127.0.0.1:1/', async () => ({ ok: false, status: 404 }))
    assert.match(reason, /HTTP 404/)
    assert.match(reason, /Build the web app/)
  })

  it('names the renderer when the service served the page', async () => {
    const reason = await describeMissingInterface('http://127.0.0.1:1/', async () => ({ ok: true, status: 200 }))
    assert.match(reason, /never rendered/)
  })

  it('names the unreachable service', async () => {
    const reason = await describeMissingInterface('http://127.0.0.1:1/', async () => { throw new Error('refused') })
    assert.match(reason, /refused/)
  })
})

describe('waitForInterface', () => {
  it('reports readiness once the application paints', async () => {
    const window = {
      webContents: {
        executeJavaScript: async () => true,
      },
    }
    const outcome = await waitForInterface({ window })
    assert.equal(outcome.ready, true)
  })

  it('keeps polling while the page navigates', async () => {
    let calls = 0
    const window = {
      webContents: {
        executeJavaScript: async () => {
          calls += 1
          if (calls < 3) throw new Error('navigation in flight')
          return true
        },
      },
    }
    const outcome = await waitForInterface({ window, sleep: async () => {} })
    assert.equal(outcome.ready, true)
    assert.equal(calls, 3)
  })

  it('reports the timeout when the application never paints', async () => {
    const window = {
      webContents: {
        executeJavaScript: async () => false,
      },
    }
    const outcome = await waitForInterface({
      window,
      timeoutMs: 0,
      sleep: async () => {},
    })
    assert.equal(outcome.ready, false)
  })
})

describe('interfaceFailureScript', () => {
  it('carries the reason and the diagnostics into the page', () => {
    const script = interfaceFailureScript({
      reason: 'The interface did not render.',
      diagnostics: ['[error] missing asset'],
    })
    assert.match(script, /The interface did not render\./)
    assert.match(script, /\[error\] missing asset/)
    assert.match(script, /location\.reload\(\)/)
  })
})
