import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { pathContainsSegment } from '../scripts/stage.mjs'

describe('pathContainsSegment', () => {
  it('matches posix workspace paths', () => {
    assert.equal(pathContainsSegment('/home/runner/work/Greeneek/Greeneek/packages/core/gnk', 'packages'), true)
    assert.equal(pathContainsSegment('/home/runner/work/Greeneek/Greeneek/vendor/cordis', 'vendor'), true)
    assert.equal(pathContainsSegment('/home/runner/work/Greeneek/Greeneek/node_modules/.pnpm/foo', 'node_modules/.pnpm'), true)
  })

  it('matches windows realpath output with backslashes', () => {
    assert.equal(pathContainsSegment('D:\\a\\Greeneek\\Greeneek\\packages\\core\\gnk', 'packages'), true)
    assert.equal(pathContainsSegment('D:\\a\\Greeneek\\Greeneek\\vendor\\cordis', 'vendor'), true)
    assert.equal(pathContainsSegment('D:\\a\\Greeneek\\Greeneek\\node_modules\\.pnpm\\foo', 'node_modules/.pnpm'), true)
  })

  it('rejects partial segment names on either separator', () => {
    assert.equal(pathContainsSegment('/repo/packages-backup/gnk', 'packages'), false)
    assert.equal(pathContainsSegment('D:\\repo\\packages-backup\\gnk', 'packages'), false)
    assert.equal(pathContainsSegment('/repo/apps/desktop', 'packages'), false)
  })
})
