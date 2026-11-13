/**
 * Greeneek session-search query language, modelled on the Obsidian (Notes)
 * global-search grammar. A query is a boolean expression over leaves:
 *
 * - every bare word or `"quoted phrase"` is a content fork (substring/FTS)
 * - `content:<value>` is the explicit content operator
 * - `path:<value>` constrains the session's working directory
 * - `file:<value>` constrains the basename of the working directory
 * - `title:<value>` constrains the session title
 * - a leading `-` negates the following operand (`-path:foo`, `-(a or b)`)
 * - `or` disjoins its two operands; juxtaposition conjoins them
 * - parentheses group with the same rules
 *
 * Compilation target is SQLite FTS5 through {@link compileContentFts5}: keep
 * clauses join as `AND`, exclusions append as infix `NOT` (the SQLite 3.54
 * grammar rejects `AND NOT` and unary `NOT`, confirmed against the shipped
 * runtime). Pure-exclusion content queries compile to `null` — FTS5 has no
 * match-all-except operator, so the caller must treat the content leg as
 * unconstrained and return no FTS rows. The wire request carries the raw
 * query; both compilers derive deterministically from it, which keeps the
 * provider cursor fingerprint consistent.
 *
 * Local (client-side) matching flows through {@link evaluateSearchQuery}. Content leaves
 * check the visible haystack in `enforce` mode (used for local rows, whose only evidence
 * is the visible haystack) or pass through under `'host-authoritative'` (remote rows,
 * proven by the host's FTS expression); the nearest `exclude` vetoes them whenever a
 * visible field confirms the needle. Visible leaves (path, file, title) always check
 * directly. `path:` evaluates the full directory, `file:` the basename, `title:` the
 * display title.
 *
 * @module @greeneek/gnk-search-query
 */

/** Maximum input length accepted by {@link parseSearchQuery}, in UTF-16 code units. */
export const SEARCH_QUERY_MAX_CHARS = 1000

/** Error codes emitted by {@link SearchQueryError}. */
export type SearchQueryErrorCode =
  | 'QUERY_TOO_LONG'
  | 'EMPTY_QUERY'
  | 'INVALID_OPERAND'
  | 'UNTERMINATED_QUOTE'
  | 'UNMATCHED_PAREN'
  | 'EMPTY_PARENS'
  | 'UNKNOWN_OPERATOR'
  | 'MISSING_OPERATOR_VALUE'
  | 'INVALID_OPERATOR'

/** Thrown for any malformed query; `code` is machine-checkable, `message` names the exact failure. */
export class SearchQueryError extends Error {
  /** Machine-checkable failure code. */
  readonly code: SearchQueryErrorCode
  constructor(code: SearchQueryErrorCode, message: string) {
    super(message)
    this.name = 'SearchQueryError'
    this.code = code
  }
}

/** One parsed leaf of the query expression. Content operators carry their own tag so diagnostics can name them. */
export type SearchQueryLeaf =
  | { readonly type: 'phrase'; readonly text: string }
  | { readonly type: 'content'; readonly text: string }
  | { readonly type: 'path'; readonly text: string }
  | { readonly type: 'file'; readonly text: string }
  | { readonly type: 'title'; readonly text: string }

/** Composite node; `allOf` is implicit (juxtaposition), `anyOf` collects `or`. */
export type SearchQueryNode =
  | SearchQueryLeaf
  | { readonly type: 'allOf'; readonly nodes: readonly SearchQueryNode[] }
  | { readonly type: 'anyOf'; readonly nodes: readonly SearchQueryNode[] }
  | { readonly type: 'exclude'; readonly node: SearchQueryNode }

/** One of the Greeneek/Notes search operators (`content:`, `path:`, `file:`, `title:`). */
export type SearchQueryOperatorName = 'content' | 'path' | 'file' | 'title'

const OPERATORS: ReadonlySet<string> = new Set(['content', 'path', 'file', 'title'])

type TokenType = 'word' | 'string' | 'lparen' | 'rparen'

/** One lexical token of a search query (exported for typed test assertions). */
export interface SearchQueryToken {
  readonly type: TokenType
  readonly value: string
  /** Leading `-` flag; never true for lparen/rparen. */
  readonly negated: boolean
}

/**
 * Tokenize raw input. NUL and control characters are rejected, quotes are honoured
 * mid-word (`path:"my dir"` is one token), `-` attaches to the following operand,
 * `or` is recognized at parse time as an infix keyword.
 *
 * @param input - caller-bounded query text; the length cap is enforced here.
 * @returns the token stream; empty streams are reported by the parser as EMPTY_QUERY.
 * @throws {SearchQueryError} QUERY_TOO_LONG, INVALID_OPERAND, UNTERMINATED_QUOTE when the input is malformed.
 */
export function tokenizeSearchQuery(input: string): SearchQueryToken[] {
  if (typeof input !== 'string') {
    throw new SearchQueryError('INVALID_OPERAND', 'search query must be text')
  }
  if (input.length > SEARCH_QUERY_MAX_CHARS) {
    throw new SearchQueryError('QUERY_TOO_LONG', `search query must be at most ${SEARCH_QUERY_MAX_CHARS} code units`)
  }
  const tokens: SearchQueryToken[] = []
  let index = 0
  const length = input.length
  while (index < length) {
    const ch = input[index] ?? ''
    if (/^\s$/u.test(ch)) {
      index += 1
      continue
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: ch === '(' ? 'lparen' : 'rparen', value: ch, negated: false })
      index += 1
      continue
    }
    let negated = false
    if (ch === '-') {
      const next = input[index + 1]
      if (next !== undefined && !/^\s$/u.test(next)) {
        negated = true
        index += 1
      } else {
        throw new SearchQueryError('INVALID_OPERAND', '`-` must attach to a non-empty operand')
      }
    }
    if (input[index] === '(') {
      tokens.push({ type: 'lparen', value: '(', negated })
      index += 1
      continue
    }
    if (input[index] === '"') {
      const end = index + 1
      let value = ''
      let i = end
      let closed = false
      while (i < length) {
        const c = input[i] ?? ''
        if (c === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
          value += input[i + 1] ?? ''
          i += 2
          continue
        }
        if (c === '"') {
          closed = true
          i += 1
          break
        }
        value += c
        i += 1
      }
      if (!closed) {
        throw new SearchQueryError('UNTERMINATED_QUOTE', 'unterminated quoted phrase in search query')
      }
      if (value === '') {
        throw new SearchQueryError('INVALID_OPERAND', 'quoted phrase must not be empty')
      }
      tokens.push({ type: 'string', value, negated })
      index = i
      continue
    }
    // A word runs until whitespace, paren, or quote. Quotes start inside it so
    // `path:"my dir"` stays one token.
    const start = index
    while (index < length) {
      const c = input[index] ?? ''
      if (/^\s$/u.test(c) || c === '(' || c === ')' || c === '"') break
      if (c === '\0') {
        throw new SearchQueryError('INVALID_OPERAND', 'search query must not contain NUL')
      }
      index += 1
    }
    const text = input.slice(start, index)
    if (text === '') {
      throw new SearchQueryError('INVALID_OPERAND', 'stray `"` inside search query')
    }
    tokens.push({ type: 'word', value: text, negated })
  }
  return tokens
}

/**
 * Parse a search query into the boolean AST.
 *
 * @param input - raw query text; the sidebar bound is 500 code units and the grammar cap is {@link SEARCH_QUERY_MAX_CHARS}.
 * @returns the combined AST; a single leaf is returned bare, juxtaposed operands combine in an allOf.
 * @throws {SearchQueryError} for every malformation — never silently recovers into a weaker query.
 */
export function parseSearchQuery(input: string): SearchQueryNode {
  const tokens = tokenizeSearchQuery(input)
  if (tokens.length === 0) {
    throw new SearchQueryError('EMPTY_QUERY', 'search query must not be empty')
  }
  let index = 0

  const peek = (): SearchQueryToken | undefined => tokens[index]
  const take = (): SearchQueryToken => {
    const token = tokens[index]
    if (token === undefined) {
      throw new SearchQueryError('INVALID_OPERAND', 'unexpected end of search query')
    }
    index += 1
    return token
  }
  const isOrKeyword = (token: SearchQueryToken | undefined): boolean =>
    token !== undefined && token.type === 'word' && !token.negated && token.value.toLowerCase() === 'or'

  const parseExpression = (): SearchQueryNode => {
    let node = parseAnd()
    while (isOrKeyword(peek())) {
      take()
      const right = parseAnd()
      if (node.type === 'anyOf') {
        node = { type: 'anyOf', nodes: [...node.nodes, right] }
        continue
      }
      node = { type: 'anyOf', nodes: [node, right] }
    }
    return node
  }

  const parseAnd = (): SearchQueryNode => {
    const parts: SearchQueryNode[] = []
    while (true) {
      const next = peek()
      if (next === undefined || next.type === 'rparen' || isOrKeyword(next)) break
      parts.push(parseUnary())
    }
    if (parts.length === 0) {
      throw new SearchQueryError('EMPTY_PARENS', 'expected an operand before operator or closing paren')
    }
    const first = parts[0]
    return parts.length === 1 && first !== undefined ? first : { type: 'allOf', nodes: parts }
  }

  const parseUnary = (): SearchQueryNode => {
    const token = peek()
    if (token === undefined) {
      throw new SearchQueryError('INVALID_OPERAND', 'unexpected end of search query')
    }
    if (!token.negated) return parsePrimary()
    if (token.type === 'lparen') {
      take()
      const node = parseExpression()
      const closing = peek()
      if (closing === undefined || closing.type !== 'rparen') {
        throw new SearchQueryError('UNMATCHED_PAREN', 'unbalanced parenthesis in search query')
      }
      take()
      return { type: 'exclude', node }
    }
    const value = parsePrimary()
    return { type: 'exclude', node: value }
  }

  const parsePrimary = (): SearchQueryNode => {
    const token = take()
    if (token.type === 'lparen') {
      if (token.negated) {
        // Negated parens are consumed by parseUnary; reaching here means a `-` attached to `(`.
        throw new SearchQueryError('INVALID_OPERAND', 'orphan negated group')
      }
      const node = parseExpression()
      const closing = peek()
      if (closing === undefined || closing.type !== 'rparen') {
        throw new SearchQueryError('UNMATCHED_PAREN', 'unbalanced parenthesis in search query')
      }
      take()
      return node
    }
    if (token.type === 'rparen') {
      throw new SearchQueryError('UNMATCHED_PAREN', 'unbalanced parenthesis in search query')
    }
    if (token.type === 'string') {
      return { type: 'phrase', text: token.value }
    }
    const colon = token.value.indexOf(':')
    if (colon === -1) {
      return { type: 'phrase', text: token.value }
    }
    const operator = token.value.slice(0, colon).toLowerCase()
    if (!OPERATORS.has(operator)) {
      throw new SearchQueryError('UNKNOWN_OPERATOR', `operator "${operator}" is not recognized in search queries`)
    }
    const remainder = token.value.slice(colon + 1)
    if (remainder !== '') {
      return leafFor(operator as SearchQueryOperatorName, remainder)
    }
    // `operator:` alone — the value is the next token, quoted or not (`path: "my dir"`).
    const valueToken = peek()
    if (valueToken === undefined || valueToken.type === 'lparen' || valueToken.type === 'rparen' || isOrKeyword(valueToken)) {
      throw new SearchQueryError('MISSING_OPERATOR_VALUE', `operator "${operator}" requires a value`)
    }
    take()
    if (valueToken.negated) {
      throw new SearchQueryError('INVALID_OPERAND', `operator "${operator}" cannot attach "-" to its following operand`)
    }
    return leafFor(operator as SearchQueryOperatorName, valueToken.value)
  }

  const leafFor = (operator: SearchQueryOperatorName, value: string): SearchQueryNode => {
    const text = value.trim()
    if (text === '') {
      throw new SearchQueryError('INVALID_OPERAND', `operator "${operator}" requires a non-empty value`)
    }
    switch (operator) {
      case 'content': return { type: 'content', text }
      case 'path': return { type: 'path', text }
      case 'file': return { type: 'file', text }
      case 'title': return { type: 'title', text }
      default: {
        const exhaustive: never = operator
        throw new SearchQueryError('INVALID_OPERATOR', `unsupported operator "${exhaustive as string}"`)
      }
    }
  }

  const node = parseExpression()
  if (index !== tokens.length) {
    throw new SearchQueryError('UNMATCHED_PAREN', 'unexpected trailing token in search query')
  }
  return node
}

/**
 * Whether the AST carries any content-bearing leaf (phrase or `content:`), positive or negated.
 *
 * @param node - a parsed AST, or a leaf.
 * @returns true when FTS5 can be asked to constrain content.
 */
export function hasContentTerms(node: SearchQueryNode): boolean {
  switch (node.type) {
    case 'phrase':
    case 'content':
      return true
    case 'path':
    case 'file':
    case 'title':
      return false
    case 'exclude':
      return hasContentTerms(node.node)
    default:
      return node.nodes.some(hasContentTerms)
  }
}

/** Reports whether the AST carries at least one `path:` leaf, any polarity.
 * @param node - the AST to inspect.
 * @returns true when any `path:` leaf exists.
 */
export function hasPathTerms(node: SearchQueryNode): boolean {
  return leaves(node).some(leaf => leaf.type === 'path')
}

/** Reports whether the AST carries at least one `file:` leaf, any polarity.
 * @param node - the AST to inspect.
 * @returns true when any `file:` leaf exists.
 */
export function hasFileTerms(node: SearchQueryNode): boolean {
  return leaves(node).some(leaf => leaf.type === 'file')
}

/** Reports whether the AST carries at least one `title:` leaf, any polarity.
 * @param node - the AST to inspect.
 * @returns true when any `title:` leaf exists.
 */
export function hasTitleTerms(node: SearchQueryNode): boolean {
  return leaves(node).some(leaf => leaf.type === 'title')
}

/** Walk every leaf in the AST in document order.
 * @param node - the AST whose leaves to walk.
 * @returns every leaf in the AST, in document order.
 */
export function collectLeaves(node: SearchQueryNode): readonly SearchQueryLeaf[] {
  return leaves(node)
}

function leaves(node: SearchQueryNode): SearchQueryLeaf[] {
  switch (node.type) {
    case 'phrase':
    case 'content':
    case 'path':
    case 'file':
    case 'title':
      return [node]
    case 'exclude':
      return leaves(node.node)
    default:
      return node.nodes.flatMap(leaves)
  }
}

/** Collect only the content leaves (phrase + `content:`), any polarity.
 * @param node - the AST whose content leaves to collect.
 * @returns every content leaf (phrase + `content:`), any polarity.
 */
export function collectContentLeaves(node: SearchQueryNode): readonly SearchQueryLeaf[] {
  return leaves(node).filter(leaf => leaf.type === 'phrase' || leaf.type === 'content')
}

function escapeFts5String(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Compile the content leg of the AST into one FTS5 expression.
 *
 * FTS5 on this runtime supports `AND`, `OR`, parens, and infix `<expr> NOT <expr>`;
 * it rejects unary `NOT` and `AND NOT`. Pure-exclusion content trees return null
 * (no match-all-except exists in FTS5) and matching branches with no content leaves
 * are skipped — they impose nothing on content. The wire caller treats null as
 * "content unconstrained", never as "match everything with FTS".
 *
 * @param node - the parsed AST.
 * @returns the MATCH expression, or null when no content leg is constraining.
 */
export function compileContentFts5(node: SearchQueryNode): string | null {
  const keep: string[] = []
  const drop: string[] = []
  const collect = (n: SearchQueryNode, polarity: 'keep' | 'drop'): void => {
    switch (n.type) {
      case 'phrase':
      case 'content': {
        const expr = escapeFts5String(n.text)
        if (polarity === 'keep') keep.push(expr)
        else drop.push(expr)
        return
      }
      case 'path':
      case 'file':
      case 'title':
        return
      case 'exclude': {
        // An exclusion is always one parenthesized operand, never a split of its
        // children (`-(a and b)` is NOT(a AND b), not (NOT a) (NOT b)).
        const inner = unit(n.node)
        if (inner === null) return
        if (polarity === 'keep') drop.push(inner)
        else keep.push(inner)
        return
      }
      case 'allOf':
        for (const child of n.nodes) collect(child, polarity)
        return
      case 'anyOf': {
        const expr = unit(n)
        if (expr !== null) {
          if (polarity === 'keep') keep.push(expr)
          else drop.push(expr)
        }
        return
      }
    }
  }
  const unit = (n: SearchQueryNode): string | null => {
    switch (n.type) {
      case 'phrase':
      case 'content':
        return escapeFts5String(n.text)
      case 'path':
      case 'file':
      case 'title':
        return null
      case 'exclude':
        // FTS5 cannot nest a NOT as an operand of OR/paren units;
        // exclusion under an anyOf is carried by the row gate instead.
        return null
      case 'allOf': {
        const parts = n.nodes.map(unit).filter((p): p is string => p !== null)
        if (parts.length === 0) return null
        if (parts.length === 1) return `(${parts[0]})`
        return `(${parts.join(' AND ')})`
      }
      case 'anyOf': {
        const parts = n.nodes.map(unit).filter((p): p is string => p !== null)
        if (parts.length === 0) return null
        if (parts.length === 1) return `(${parts[0]})`
        return `(${parts.join(' OR ')})`
      }
    }
  }
  collect(node, 'keep')
  if (keep.length === 0) return null
  const first = keep[0]
  if (first === undefined) return null
  const keepExpr = keep.length === 1 ? first : `(${keep.join(' AND ')})`
  if (drop.length === 0) return keepExpr
  return `${keepExpr} NOT ${drop.join(' NOT ')}`
}

/**
 * One visible document behind a search row: title, working directory, the workspace
 * label, and (when the row came from a content match) the host snippet.
 */
export interface SearchHaystack {
  /** Session display title; optional in tests and index-less surfaces. */
  readonly title?: string | null | undefined
  /** Session working directory; optional when the host cannot resolve it. */
  readonly path?: string | null | undefined
  /** Workspace display label; only folder-level tests use it. */
  readonly label?: string | null | undefined
  /** The host-provided content snippet, when the row came from a content match. */
  readonly snippet?: string | null | undefined
}

const normalizeHay = (value: string | null | undefined): string => (value ?? '').toLowerCase()

/** Separator-insensitive haystack for path predicates: Greeneek runs on Windows and POSIX. */
const normalizePathHay = (value: string | null | undefined): string =>
  normalizeHay(value).replace(/\\/gu, '/')

const visibleHaystack = (doc: SearchHaystack): string =>
  [doc.title, doc.path, doc.label, doc.snippet]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join('\n')
    .toLowerCase()

const basenameOf = (pathText: string): string => {
  const normalized = pathText.replace(/\\/gu, '/')
  const last = normalized.lastIndexOf('/')
  return last === -1 ? normalized : normalized.slice(last + 1)
}

const leafMatches = (leaf: SearchQueryLeaf, doc: SearchHaystack): boolean => {
  const needle = leaf.text.toLowerCase()
  switch (leaf.type) {
    case 'phrase':
    case 'content':
      return visibleHaystack(doc).includes(needle)
    case 'path':
      return normalizePathHay(doc.path).includes(needle.replace(/\\/gu, '/'))
    case 'file':
      return basenameOf(normalizeHay(doc.path)).includes(leaf.text.toLowerCase())
    case 'title':
      return normalizeHay(doc.title).includes(needle)
    default: {
      const exhaustive: never = leaf
      throw new SearchQueryError('INVALID_OPERATOR', `unhandled leaf ${(exhaustive as { type: string }).type}`)
    }
  }
}

/**
 * Positive-content semantics: `enforce` checks the visible haystack; `host-authoritative`
 * trusts the host FTS leg completely.
 */
export type ContentLegMode = 'enforce' | 'host-authoritative'

/** Options for {@link evaluateSearchQuery}. */
export interface EvaluateSearchOptions {
  /** Content-leg semantics on the positive axis; default `'enforce'`. */
  readonly contentLeaves?: ContentLegMode | undefined
}

/**
 * Evaluate the full AST against the visible fields of one row. Content leaves check the
 * visible haystack in `enforce` mode (local rows: title + path, no content possible) or
 * pass through under `'host-authoritative'` (remote rows: the host FTS expression already
 * proved them). Inside an `exclude`, content leaves veto only when a visible field —
 * title, path, or the snippet — contains the needle; a row with no confirming field
 * passes, since the host already handled the content side. Visible leaves (path, file,
 * title) always check directly.
 *
 * @param node - the parsed AST.
 * @param doc - the visible fields of the row being tested.
 * @param options - content-leg semantics; `host-authoritative` for rows the host matched.
 * @returns true when the row satisfies the whole expression.
 */
export function evaluateSearchQuery(node: SearchQueryNode, doc: SearchHaystack, options?: EvaluateSearchOptions): boolean {
  const contentMode = options?.contentLeaves ?? 'enforce'
  const evalNode = (n: SearchQueryNode, polarity: 'keep' | 'drop'): boolean => {
    switch (n.type) {
      case 'phrase':
      case 'content': {
        if (polarity === 'keep' && contentMode === 'host-authoritative') return true
        return visibleHaystack(doc).includes(n.text.toLowerCase())
      }
      case 'path':
      case 'file':
      case 'title':
        // Visible leaves are polarity-independent checks; the nearest
        // `exclude` wrapper negates the result.
        return leafMatches(n, doc)
      case 'allOf':
        return n.nodes.every(child => evalNode(child, polarity))
      case 'anyOf':
        return n.nodes.some(child => evalNode(child, polarity))
      case 'exclude':
        return !evalNode(n.node, polarity === 'keep' ? 'drop' : 'keep')
    }
  }
  return evalNode(node, 'keep')
}
