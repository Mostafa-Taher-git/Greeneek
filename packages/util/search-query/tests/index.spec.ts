import { describe, expect, it } from 'vitest'
import {
  collectContentLeaves,
  collectLeaves,
  compileContentFts5,
  evaluateSearchQuery,
  hasContentTerms,
  hasFileTerms,
  hasPathTerms,
  hasTitleTerms,
  parseSearchQuery,
  SearchQueryError,
  tokenizeSearchQuery,
  type SearchQueryNode,
} from '@greeneek/gnk-search-query'

const phrase = (text: string): SearchQueryNode => ({ type: 'phrase', text })

describe('tokenizer', () => {
  it('splits whitespace-separated words', () => {
    expect(tokenizeSearchQuery('hello world')).toEqual([
      { type: 'word', value: 'hello', negated: false },
      { type: 'word', value: 'world', negated: false },
    ])
  })

  it('keeps quoted phrases as one token, escapes quote and backslash', () => {
    expect(tokenizeSearchQuery('"a \\"b\\" \\\\c"')).toEqual([
      { type: 'string', value: 'a "b" \\c', negated: false },
    ])
  })

  it('supports quotes inside operator prefixes', () => {
    expect(tokenizeSearchQuery('path:"my dir"')).toEqual([
      { type: 'word', value: 'path:', negated: false },
      { type: 'string', value: 'my dir', negated: false },
    ])
  })

  it('rejects `-` without a following operand', () => {
    expect(() => tokenizeSearchQuery('-')).toThrow(SearchQueryError)
    expect(() => tokenizeSearchQuery('- ')).toThrow(SearchQueryError)
  })

  it('rejects unterminated quotes', () => {
    expect(() => tokenizeSearchQuery('"never closed')).toThrow(SearchQueryError)
  })

  it('rejects NUL in words', () => {
    expect(() => tokenizeSearchQuery('a\0b')).toThrow(SearchQueryError)
  })

  it('caps length at 1000 code units', () => {
    expect(() => tokenizeSearchQuery('a'.repeat(1001))).toThrow(SearchQueryError)
  })

  it('tokenizes negated parens as one unit', () => {
    expect(tokenizeSearchQuery('-(a or b)')).toEqual([
      { type: 'lparen', value: '(', negated: true },
      { type: 'word', value: 'a', negated: false },
      { type: 'word', value: 'or', negated: false },
      { type: 'word', value: 'b', negated: false },
      { type: 'rparen', value: ')', negated: false },
    ])
  })
})

describe('parseSearchQuery', () => {
  it('throws EMPTY_QUERY for whitespace-only input', () => {
    expect(() => parseSearchQuery('   ')).toThrow(SearchQueryError)
    expect(() => parseSearchQuery('')).toThrow(SearchQueryError)
  })

  it('parses a bare word as a phrase leaf', () => {
    expect(parseSearchQuery('hello')).toEqual(phrase('hello'))
  })

  it('conjoins juxtaposed words into an allOf', () => {
    expect(parseSearchQuery('foo bar')).toEqual({
      type: 'allOf',
      nodes: [phrase('foo'), phrase('bar')],
    })
  })

  it('`or` disjoins its operands case-insensitively', () => {
    expect(parseSearchQuery('a or b')).toEqual({
      type: 'anyOf',
      nodes: [phrase('a'), phrase('b')],
    })
    expect(parseSearchQuery('a OR b')).toEqual(parseSearchQuery('a or b'))
  })

  it('`or` has lower precedence than juxtaposition', () => {
    expect(parseSearchQuery('a b or c')).toEqual({
      type: 'anyOf',
      nodes: [
        { type: 'allOf', nodes: [phrase('a'), phrase('b')] },
        phrase('c'),
      ],
    })
  })

  it('`-` negates one operand', () => {
    expect(parseSearchQuery('foo -bar')).toEqual({
      type: 'allOf',
      nodes: [phrase('foo'), { type: 'exclude', node: phrase('bar') }],
    })
  })

  it('`-` negates an entire parenthesized group', () => {
    expect(parseSearchQuery('-(a or b c)')).toEqual({
      type: 'exclude',
      node: {
        type: 'anyOf',
        nodes: [
          phrase('a'),
          { type: 'allOf', nodes: [phrase('b'), phrase('c')] },
        ],
      },
    })
  })

  it('parses path: and file: and title: operators', () => {
    expect(parseSearchQuery('path:apps/desktop')).toEqual({ type: 'path', text: 'apps/desktop' })
    expect(parseSearchQuery('path:"multi word"')).toEqual({ type: 'path', text: 'multi word' })
    expect(parseSearchQuery('file:installer')).toEqual({ type: 'file', text: 'installer' })
    expect(parseSearchQuery('title:release')).toEqual({ type: 'title', text: 'release' })
    expect(parseSearchQuery('content:trace')).toEqual({ type: 'content', text: 'trace' })
  })

  it('rejects unknown operators by name', () => {
    const thrown = catchError(() => parseSearchQuery('bogus:value'))
    expect(thrown).toBeInstanceOf(SearchQueryError)
    expect((thrown as SearchQueryError).code).toBe('UNKNOWN_OPERATOR')
    expect((thrown as SearchQueryError).message).toContain('bogus')
  })

  it('rejects missing operator value', () => {
    expect(() => parseSearchQuery('path: or foo')).toThrow(SearchQueryError)
    expect(() => parseSearchQuery('content:')).toThrow(SearchQueryError)
  })

  it('rejects malformed parens', () => {
    expect(() => parseSearchQuery('(a')).toThrow(SearchQueryError)
    expect(() => parseSearchQuery('a)')).toThrow(SearchQueryError)
    expect(() => parseSearchQuery('(')).toThrow(SearchQueryError)
  })

  it('accepts operator value on the following token', () => {
    expect(parseSearchQuery('path: "my dir"')).toEqual({ type: 'path', text: 'my dir' })
  })
})

describe('compileContentFts5', () => {
  it('returns null when no content leaves exist', () => {
    expect(compileContentFts5(parseSearchQuery('path:apps'))).toBeNull()
    expect(compileContentFts5(parseSearchQuery('path:apps title:foo'))).toBeNull()
  })

  it('compiles a single phrase', () => {
    expect(compileContentFts5(parseSearchQuery('hello'))).toBe('"hello"')
  })

  it('conjoins with AND', () => {
    expect(compileContentFts5(parseSearchQuery('foo bar'))).toBe('("foo" AND "bar")')
  })

  it('compiles or into parens', () => {
    expect(compileContentFts5(parseSearchQuery('foo or bar'))).toBe('("foo" OR "bar")')
  })

  it('appends exclusions as infix NOT', () => {
    expect(compileContentFts5(parseSearchQuery('foo -bar'))).toBe('"foo" NOT "bar"')
  })

  it('paren-groups excluded conjunctions as one operand', () => {
    expect(compileContentFts5(parseSearchQuery('foo -(a b)'))).toBe('"foo" NOT ("a" AND "b")')
  })

  it('keeps excluded disjunctions parenthesized', () => {
    expect(compileContentFts5(parseSearchQuery('foo -(a or b)'))).toBe('"foo" NOT ("a" OR "b")')
  })

  it('compiles nested expression with both sides of NOT', () => {
    expect(compileContentFts5(parseSearchQuery('(foo or bar) -(baz qux)')))
      .toBe('("foo" OR "bar") NOT ("baz" AND "qux")')
  })

  it('ignores path/file/title leaves — they cannot constrain content', () => {
    expect(compileContentFts5(parseSearchQuery('path:apps/desktop foo'))).toBe('"foo"')
    expect(compileContentFts5(parseSearchQuery('title:foo or bar'))).toBe('("bar")')
  })

  it('returns null for a pure exclusion to signal content-unconstrained', () => {
    expect(compileContentFts5(parseSearchQuery('-foo'))).toBeNull()
    expect(compileContentFts5(parseSearchQuery('-(a or b)'))).toBeNull()
    expect(compileContentFts5(parseSearchQuery('-(a and b)'))).toBeNull()
  })

  it('double-negation carries no content constraint', () => {
    expect(compileContentFts5(parseSearchQuery('foo -(-bar)'))).toBe('"foo"')
  })

  it('quote escaping doubles double quotes', () => {
    expect(compileContentFts5(parseSearchQuery('"she said \\"hi\\""'))).toBe('"she said ""hi"""')
  })
})

describe('hasContentTerms / leaf collectors', () => {
  it('reports content presence', () => {
    expect(hasContentTerms(parseSearchQuery('path:x'))).toBe(false)
    expect(hasContentTerms(parseSearchQuery('foo'))).toBe(true)
    expect(hasContentTerms(parseSearchQuery('path:x (foo or path:y)'))).toBe(true)
  })

  it('detects path/file/title leaves', () => {
    const ast = parseSearchQuery('path:a file:b title:c foo')
    expect(hasPathTerms(ast)).toBe(true)
    expect(hasFileTerms(ast)).toBe(true)
    expect(hasTitleTerms(ast)).toBe(true)
  })

  it('collects only content leaves', () => {
    const leaves = collectContentLeaves(parseSearchQuery('path:a foo bar -baz'))
    expect(leaves.map(l => l.text)).toEqual(['foo', 'bar', 'baz'])
  })

  it('walks excludes in document order', () => {
    const texts = collectLeaves(parseSearchQuery('alpha -(beta or gamma) delta')).map(l => l.text)
    expect(texts.slice(1)).toEqual(['beta', 'gamma', 'delta'])
  })
})

describe('evaluateSearchQuery', () => {
  const doc = {
    title: 'Release notes v0.4.4',
    path: 'D:\\work\\greeneek-harness\\apps\\desktop',
    snippet: 'tagged desktop-v0.4.4 on top of green',
  }

  it('matches title and path substring leaves locally', () => {
    expect(evaluateSearchQuery(parseSearchQuery('release'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('desktop'), doc)).toBe(true)
    // Enforce mode: a content leaf with no visible-field support is false.
    expect(evaluateSearchQuery(parseSearchQuery('absent'), doc)).toBe(false)
  })

  it('title: constrains only the title', () => {
    expect(evaluateSearchQuery(parseSearchQuery('title:release'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('title:apps'), doc)).toBe(false)
  })

  it('path: constrains the full directory', () => {
    expect(evaluateSearchQuery(parseSearchQuery('path:apps/desktop'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('path:desktop'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('path:work/other'), doc)).toBe(false)
  })

  it('file: constrains the basename only', () => {
    expect(evaluateSearchQuery(parseSearchQuery('file:desktop'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('file:apps'), doc)).toBe(false)
    expect(evaluateSearchQuery(parseSearchQuery('file:greeneek-harness'), doc)).toBe(false)
  })

  it('file: splits windows separators as well as POSIX', () => {
    expect(evaluateSearchQuery(parseSearchQuery('file:desktop'), {
      path: 'C:\\Users\\x\\Desktop',
    })).toBe(true)
  })

  it('evaluates exclude as negation over the haystack', () => {
    expect(evaluateSearchQuery(parseSearchQuery('-desktop'), doc)).toBe(false)
    expect(evaluateSearchQuery(parseSearchQuery('release -absent'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('release -desktop'), doc)).toBe(false)
  })

  it('evaluates or across predicate types', () => {
    expect(evaluateSearchQuery(parseSearchQuery('title:tagged or path:apps/desktop'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('title:nope or path:elsewhere'), doc)).toBe(false)
  })

  it('is case-insensitive on both needle and haystack', () => {
    expect(evaluateSearchQuery(parseSearchQuery('PATH:APPS/DESKTOP'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('Title:RELEASE'), doc)).toBe(true)
  })

  it('host-authoritative rows take content on faith from the host FTS leg', () => {
    expect(evaluateSearchQuery(parseSearchQuery('release'), doc, { contentLeaves: 'host-authoritative' })).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('absent'), doc, { contentLeaves: 'host-authoritative' })).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('absent -desktop'), doc, { contentLeaves: 'host-authoritative' })).toBe(false)
    expect(evaluateSearchQuery(parseSearchQuery('absent -other'), doc, { contentLeaves: 'host-authoritative' })).toBe(true)
  })

  it('a content exclusion vetoes only when a visible field contains the needle', () => {
    expect(evaluateSearchQuery(parseSearchQuery('-desktop'), doc)).toBe(false)
    expect(evaluateSearchQuery(parseSearchQuery('-nonsense'), doc)).toBe(true)
  })

  it('a double negation imposes no constraint', () => {
    expect(evaluateSearchQuery(parseSearchQuery('-(-desktop)'), doc)).toBe(true)
    expect(evaluateSearchQuery(parseSearchQuery('release -(-desktop)'), doc)).toBe(true)
  })

  it('a content exclusion vetoes the merged row on the snippet text', () => {
    expect(evaluateSearchQuery(parseSearchQuery('-tagged'), { title: 'x', path: 'y', snippet: 'tagged here' })).toBe(false)
    expect(evaluateSearchQuery(parseSearchQuery('-tagged'), { title: 'x', path: 'y', snippet: 'nope' })).toBe(true)
  })
})

function catchError(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}
