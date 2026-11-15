import { describe, expect, it } from 'vitest'
import { formatCount, pathBasename } from '../src/client/format.ts'

describe('formatCount', () => {
  it('groups thousands with the ASCII separator', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('1,000')
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})

describe('pathBasename', () => {
  it('returns the final segment for either separator style', () => {
    expect(pathBasename('/projects/demo-app')).toBe('demo-app')
    expect(pathBasename('D:\\projects\\demo-app')).toBe('demo-app')
  })

  it('ignores trailing separators', () => {
    expect(pathBasename('/projects/demo-app/')).toBe('demo-app')
    expect(pathBasename('D:\\projects\\demo-app\\\\')).toBe('demo-app')
  })

  it('returns a path with no separator unchanged', () => {
    expect(pathBasename('demo-app')).toBe('demo-app')
  })
})
