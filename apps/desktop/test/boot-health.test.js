import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  clearBootFailures,
  readBootFailures,
  recordBootFailure,
  SAFE_MODE_FAILURE_THRESHOLD,
} from '../src/boot-health.js'

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    async readFileImpl(path) {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeFileImpl(path, content) {
      files.set(path, String(content))
    },
    async rmImpl(path) {
      files.delete(path)
    },
  }
}

describe('boot health', () => {
  it('triggers safe mode after three consecutive failures', () => {
    assert.equal(SAFE_MODE_FAILURE_THRESHOLD, 3)
  })

  it('reads zero when the counter is missing or torn', async () => {
    const fs = memoryFiles()
    assert.equal(await readBootFailures('/u', fs.readFileImpl), 0)
    fs.files.set('/u/boot-health.json', 'not json')
    assert.equal(await readBootFailures('/u', fs.readFileImpl), 0)
    fs.files.set('/u/boot-health.json', JSON.stringify({ failures: 'x' }))
    assert.equal(await readBootFailures('/u', fs.readFileImpl), 0)
  })

  it('counts consecutive failures and clears on success', async () => {
    const fs = memoryFiles()
    assert.equal(await recordBootFailure('/u', fs), 1)
    assert.equal(await recordBootFailure('/u', fs), 2)
    assert.equal(await recordBootFailure('/u', fs), 3)
    assert.equal(await readBootFailures('/u', fs.readFileImpl), 3)
    await clearBootFailures('/u', fs.rmImpl)
    assert.equal(await readBootFailures('/u', fs.readFileImpl), 0)
  })
})
