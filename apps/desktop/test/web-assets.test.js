import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { webAppBuilt } from '../scripts/web-assets.mjs'

describe('webAppBuilt', () => {
  it('reports a missing interface so the launcher can build it', () => {
    assert.equal(webAppBuilt('/nowhere/dist/index.html', () => false), false)
  })

  it('reports a present interface', () => {
    assert.equal(webAppBuilt('/somewhere/dist/index.html', () => true), true)
  })
})
