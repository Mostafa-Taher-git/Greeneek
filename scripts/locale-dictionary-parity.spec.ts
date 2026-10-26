/**
 * Gate for the invariant `FALLBACK_LOCALE` rests on: every shipped dictionary
 * declares the same keys, in the same order, with the same placeholders in
 * `zh`, `en`, and `ar`.
 *
 * The locale runtime resolves a key through the active locale, then through
 * the single fallback locale (`en`), then surfaces the key itself. With
 * symmetric dictionaries that middle step always resolves, so one constant can
 * serve as both the opening locale and the dictionary fallback. A key added to
 * only one side breaks that: a reader of the other language sees a bare key
 * such as `list.aria` instead of text. A key present in every dictionary but
 * carrying different `{placeholder}` tokens is worse than missing — the
 * template renders with an unfilled token or silently drops a value. This gate
 * fails on the asymmetry rather than waiting for the bare key or the literal
 * `{name}` to reach a UI.
 *
 * Discovery is deliberately broad, because a gate that silently narrows is
 * worse than no gate. It sweeps every workspace package (not just
 * `packages/client`), reads dictionaries wherever they are declared —
 * `locales.ts`, a `locales/` directory, or inline in the plugin body — and
 * pairs the three locales across sibling files as well as within one module.
 * A `zh` dictionary whose `en` or `ar` counterpart cannot be found anywhere is
 * an error, not a skip.
 */

import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Shipped locales; `zh` is the key-set and key-order reference. */
const LOCALES = ['zh', 'en', 'ar'] as const

/** One shipped locale id. */
type Locale = typeof LOCALES[number]

/** Title-cased suffix a locale uses in `settingsZh`-shaped export names. */
const LOCALE_SUFFIX: Record<Locale, string> = { zh: 'Zh', en: 'En', ar: 'Ar' }

/** Repo-relative path with `/` separators, so messages and suffix tests match on every OS. */
function relative(file: string): string {
  return file.slice(root.length).replaceAll('\\', '/')
}

/** Every `.ts` source file under each workspace package's `src`, excluding declarations. */
function sourceFiles(): string[] {
  const files: string[] = []
  const packagesRoot = resolve(root, 'packages')
  for (const group of directories(packagesRoot)) {
    for (const pkg of directories(resolve(packagesRoot, group))) {
      walk(resolve(packagesRoot, group, pkg, 'src'), files)
    }
  }
  return files.sort()
}

/** Immediate subdirectory names, or none when the path is not a directory. */
function directories(dir: string): string[] {
  return readEntries(dir).filter(entry => entry.isDirectory()).map(entry => entry.name)
}

/**
 * Directory entries, treating only a genuinely absent directory as empty.
 * Any other failure (`EACCES`, I/O) rethrows: silently reading it as "absent"
 * would narrow the sweep and let the gate pass while checking less.
 * @param dir - absolute directory path.
 * @returns entries, or none when the directory does not exist.
 */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function walk(dir: string, out: string[]): void {
  for (const entry of readEntries(dir)) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
  }
}

/** One discovered dictionary: which file and export name declared it. */
interface Dictionary {
  /** Repo-relative declaring file. */
  file: string
  /** Export name, or the registration site for an inline literal. */
  name: string
  /** Declared keys in declaration order. */
  keys: string[]
  /** `{placeholder}` tokens declared per key, sorted. */
  tokens: Map<string, string[]>
}

/** Keys and placeholders of one dictionary object literal. */
interface DictionaryEntries {
  /** Property names in declaration order. */
  keys: string[]
  /** `{placeholder}` tokens per key, sorted. */
  tokens: Map<string, string[]>
}

/** Module facts a dictionary value is resolved through, across relative imports. */
interface ModuleScope {
  /** Absolute declaring file. */
  file: string
  /** Module-scope variable initializers keyed by local name. */
  consts: Map<string, ts.Expression>
  /** Relative named imports: local binding to module specifier and exported name. */
  imports: Map<string, { specifier: string; imported: string }>
}

const parsedModules = new Map<string, ts.SourceFile>()
const moduleScopes = new Map<string, ModuleScope>()

/**
 * Parse a module once per path, treating only a genuinely absent file as
 * absent; any other read failure rethrows instead of narrowing the resolution.
 * @param file - absolute module path.
 * @returns the parsed source, or undefined when the file does not exist.
 */
function parseModule(file: string): ts.SourceFile | undefined {
  const cached = parsedModules.get(file)
  if (cached !== undefined) return cached
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  parsedModules.set(file, source)
  return source
}

/**
 * Module-scope bindings of one module: its own constant initializers plus the
 * local names its relative named imports bind.
 * @param file - absolute module path.
 * @param source - already-parsed source for `file`, when the caller has one.
 * @returns the module scope, or undefined when the file does not exist.
 */
function moduleScopeOf(file: string, source?: ts.SourceFile): ModuleScope | undefined {
  const cached = moduleScopes.get(file)
  if (cached !== undefined) return cached
  const parsed = source ?? parseModule(file)
  if (parsed === undefined) return undefined
  const consts = new Map<string, ts.Expression>()
  const imports = new Map<string, { specifier: string; imported: string }>()
  for (const statement of parsed.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) consts.set(decl.name.text, decl.initializer)
      }
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      imports.set(element.name.text, {
        specifier: statement.moduleSpecifier.text,
        imported: (element.propertyName ?? element.name).text,
      })
    }
  }
  const scope: ModuleScope = { file, consts, imports }
  moduleScopes.set(file, scope)
  return scope
}

/**
 * Resolve a local name to the initializer it names, following one relative
 * import hop when the name is imported rather than declared here.
 * @param name - local binding name.
 * @param scope - module the name is read in.
 * @returns the declaring scope and initializer, or undefined.
 */
function bindingOf(
  name: string,
  scope: ModuleScope,
): { scope: ModuleScope; expression: ts.Expression } | undefined {
  const own = scope.consts.get(name)
  if (own !== undefined) return { scope, expression: own }
  const imported = scope.imports.get(name)
  if (imported === undefined || !imported.specifier.startsWith('.')) return undefined
  const target = resolve(dirname(scope.file), imported.specifier)
  const targetScope = moduleScopeOf(target)
  if (targetScope === undefined) return undefined
  const expression = targetScope.consts.get(imported.imported)
  return expression === undefined ? undefined : { scope: targetScope, expression }
}

/**
 * Keys of every top-level `export const <name> = { ... }` object literal whose
 * name identifies a locale dictionary, plus inline `register(ns, locale, {...})`
 * literals. Read from the AST so the gate never executes package code.
 * @param file - absolute path of a candidate module.
 * @returns discovered dictionaries, keyed by locale-bearing name.
 */
function dictionariesIn(file: string): Dictionary[] {
  const text = readFileSync(file, 'utf8')
  // Cheap pre-filter: parsing every package source is wasteful. The pattern
  // must admit every shape `localeOf` accepts, or a file would be skipped
  // before parsing — the silent narrowing this gate exists to prevent. A bare
  // `\b(zh|en|ar)\b` misses `zhSettings`/`accessAr`, because `\b` does not hold
  // between `h` and an uppercase letter.
  if (!/\b(zh|en|ar)\b|\b(zh|en|ar)[A-Z]|(Zh|En|Ar)\b/.test(text)) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  parsedModules.set(file, source)
  // Module-scope bindings, keyed by name, including relative imports. A 3-arg
  // `register(NS, 'zh'|'en'|'ar', dict)` whose third argument is an identifier
  // — e.g. a local dictionary variable rather than an inline literal — and
  // values naming an imported dictionary both resolve through here so the gate
  // still measures what it verifies.
  const scope = moduleScopeOf(file, source)
  if (scope === undefined) throw new Error(`cannot read module scope for ${file}`)
  const found: Dictionary[] = []
  const rel = relative(file)

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      const literal = unwrap(decl.initializer)
      if (literal === undefined || !ts.isObjectLiteralExpression(literal)) continue
      if (localeOf(decl.name.text) === undefined) continue
      found.push({ file: rel, name: decl.name.text, ...entriesOf(literal, scope, rel, decl.name.text) })
    }
  }

  // A 3-arg `register(ns, 'zh'|'en'|'ar', dict)` call whose dictionary
  // argument we cannot turn into an object literal. We refuse instead of
  // skipping: a registration we cannot measure is exactly the silent
  // narrowing this gate exists to catch.
  const refuse = (ns: string, tag: string, why: string): never => {
    throw new Error(`cannot verify register('${ns}', '${tag}', ...) in ${rel}: ${why}`)
  }

  // Inline registrations, two shapes. A `[['zh', {...}], ['en', {...}],
  // ['ar', {...}]]` list handed to a registration loop keys off the enclosing
  // array; separate `register(NS, 'zh', {...})` / `register(NS, 'en', {...})`
  // calls key off the namespace argument, so the calls group with each other.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee) && callee.text === 'register' ? 'register' : undefined
      if (name === 'register' && node.arguments.length >= 3) {
        const [ns, tag, dict] = node.arguments
        if (ns === undefined || tag === undefined || !ts.isStringLiteral(tag)) return
        if (!LOCALES.includes(tag.text as Locale)) return
        const raw = unwrap(dict)
        const bound = raw !== undefined && ts.isIdentifier(raw) ? bindingOf(raw.text, scope) : undefined
        const literal = bound === undefined ? raw : unwrap(bound.expression)
        const why = raw !== undefined && ts.isIdentifier(raw)
          ? `third argument ${raw.text} does not resolve to an inline or module-scope object literal`
          : 'third argument is neither an object literal nor a resolvable dictionary variable'
        if (literal === undefined || !ts.isObjectLiteralExpression(literal)) {
          // The dictionary argument must resolve to an object literal; the
          // gate refuses rather than skips, so the symmetry it verifies never
          // silently narrows.
          refuse(ns.getText(source), tag.text, why)
        }
        const dictionary: ts.ObjectLiteralExpression = literal as ts.ObjectLiteralExpression
        // The namespace expression's source text identifies the pair, so the
        // locale calls for one namespace meet and calls for different
        // namespaces stay apart.
        found.push({
          file: rel,
          name: `${tag.text}@register:${ns.getText(source)}`,
          ...entriesOf(dictionary, bound?.scope ?? scope, rel, `${tag.text}@register:${ns.getText(source)}`),
        })
      }
    }
    if (ts.isArrayLiteralExpression(node) && node.elements.length >= 2) {
      const site = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      for (const element of node.elements) {
        if (!ts.isArrayLiteralExpression(element) || element.elements.length !== 2) continue
        const [tag, dict] = element.elements
        const literal = unwrap(dict)
        if (tag === undefined || !ts.isStringLiteral(tag)) continue
        if (literal === undefined || !ts.isObjectLiteralExpression(literal)) continue
        if (!LOCALES.includes(tag.text as Locale)) continue
        found.push({
          file: rel,
          name: `${tag.text}@inline:${site}`,
          ...entriesOf(literal, scope, rel, `${tag.text}@inline:${site}`),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Declared property names, in order, and the `{placeholder}` tokens their
 * values interpolate. Values must resolve statically — a dictionary entry we
 * cannot read mechanically would be a silent hole in the placeholders check.
 * @param literal - dictionary object literal.
 * @param scope - module the literal is declared in, for constant and import resolution.
 * @param file - repo-relative declaring file, for the refusal message.
 * @param name - dictionary export or registration name, for the refusal message.
 * @returns declared keys and per-key placeholder tokens.
 */
function entriesOf(
  literal: ts.ObjectLiteralExpression,
  scope: ModuleScope,
  file: string,
  name: string,
): DictionaryEntries {
  const keys: string[] = []
  const tokens = new Map<string, string[]>()
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue
    const key = prop.name.text
    const text = staticTextOf(prop.initializer, scope)
    if (text === undefined) {
      throw new Error(`cannot verify placeholders for ${name}.${key} in ${file}: value is not static text`)
    }
    keys.push(key)
    tokens.set(key, placeholderTokens(text))
  }
  return { keys, tokens }
}

/**
 * Static text an expression resolves to: string literals, `+` concatenations,
 * module-scope identifiers naming either (in this module or one relative
 * import away), and element reads of such a dictionary object
 * (`accessZh['preset.readOnly']`).
 * @param node - candidate value expression.
 * @param scope - module the expression is read in.
 * @param seen - bindings already being resolved, so a cyclic alias refuses instead of recursing forever.
 * @returns the resolved text, or undefined when the value is not statically readable.
 */
function staticTextOf(
  node: ts.Expression,
  scope: ModuleScope,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return staticTextOf(node.expression, scope, seen)
  if (ts.isIdentifier(node)) {
    const bound = bindingOf(node.text, scope)
    if (bound === undefined) return undefined
    const binding = `${bound.scope.file}::${node.text}`
    if (seen.has(binding)) return undefined
    return staticTextOf(bound.expression, bound.scope, new Set(seen).add(binding))
  }
  if (
    ts.isElementAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && ts.isStringLiteral(node.argumentExpression)
  ) {
    const bound = bindingOf(node.expression.text, scope)
    const literal = bound === undefined ? undefined : unwrap(bound.expression)
    if (bound === undefined || literal === undefined || !ts.isObjectLiteralExpression(literal)) return undefined
    const key = node.argumentExpression.text
    const property = literal.properties.find(candidate =>
      ts.isPropertyAssignment(candidate)
      && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name))
      && candidate.name.text === key)
    return property !== undefined && ts.isPropertyAssignment(property)
      ? staticTextOf(property.initializer, bound.scope, seen)
      : undefined
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticTextOf(node.left, scope, seen)
    const right = staticTextOf(node.right, scope, seen)
    return left === undefined || right === undefined ? undefined : left + right
  }
  return undefined
}

/** `{name}` tokens of a template string, sorted. */
function placeholderTokens(text: string): string[] {
  const tokens = new Set<string>()
  for (const match of text.matchAll(/\{(\w+)\}/gu)) tokens.add(match[1] ?? '')
  return [...tokens].sort()
}

/** Look through `satisfies`/`as`/parenthesized wrappers to the literal. */
function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  let current = node
  while (
    current !== undefined
    && (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current))
  ) {
    current = current.expression
  }
  return current
}

/**
 * The locale a dictionary name declares, and the namespace-ish remainder that
 * identifies which group it belongs to. `zh`/`en`/`ar`, `zhSettings`/
 * `arAccess`, and `settingsZh`/`accessAr` are the shapes this repo uses. A
 * name-prefix shape requires an uppercase ASCII letter at the third position
 * (`[A-Z]`), matching the admission of the cheap pre-filter, so `zh2Foo`/
 * `ar_probe` cannot be treated as dictionaries in one place and skipped in
 * another.
 * @param name - export name or synthetic inline name.
 * @returns locale plus group key, or undefined when the name names no locale.
 */
function localeOf(name: string): { locale: Locale; pair: string } | undefined {
  for (const locale of LOCALES) {
    if (name === locale) return { locale, pair: '' }
    // Synthetic names for inline shapes carry their own pair key after the
    // first ':' (the enclosing array's line, or the namespace expression).
    if (name.startsWith(`${locale}@`)) return { locale, pair: name.slice(name.indexOf(':')) }
    if (name.startsWith(locale) && name.length > 2 && /[A-Z]/.test(name[2] ?? '')) {
      return { locale, pair: name.slice(2) }
    }
    const suffix = LOCALE_SUFFIX[locale]
    if (name.endsWith(suffix)) return { locale, pair: name.slice(0, -suffix.length) }
  }
  return undefined
}

/**
 * Every way one dictionary departs from the zh reference dictionary:
 * missing keys, extra keys, a different order, or different placeholders.
 * @param base - the zh dictionary (key-set and order source of truth).
 * @param other - the en or ar dictionary checked against it.
 * @returns human-readable departures, empty when the two agree.
 */
function departuresFrom(base: Dictionary, other: Dictionary): string[] {
  const problems: string[] = []
  const missing = base.keys.filter(key => !other.keys.includes(key))
  const extra = other.keys.filter(key => !base.keys.includes(key))
  if (missing.length > 0) problems.push(`${other.file} ${other.name} has keys absent from ${base.name}: ${missing.join(', ')}`)
  if (extra.length > 0) problems.push(`${other.file} ${other.name} has keys absent from ${base.name}: ${extra.join(', ')}`)
  if (missing.length === 0 && extra.length === 0) {
    const index = base.keys.findIndex((key, position) => other.keys[position] !== key)
    if (index !== -1) {
      problems.push(
        `${other.file} ${other.name} declares key "${other.keys[index] ?? ''}" at position ${index} `
        + `where ${base.name} declares "${base.keys[index] ?? ''}"`,
      )
    }
    for (const key of base.keys) {
      const expected = base.tokens.get(key) ?? []
      const actual = other.tokens.get(key) ?? []
      if (expected.join('\u0000') !== actual.join('\u0000')) {
        problems.push(
          `${other.file} ${other.name} key "${key}" interpolates `
          + `${actual.length === 0 ? 'no placeholders' : `{${actual.join('}, {')}}`} where `
          + `${base.name} interpolates ${expected.length === 0 ? 'none' : `{${expected.join('}, {')}}`}`,
        )
      }
    }
  }
  return problems
}

describe('shipped locale dictionaries', () => {
  it('declares the same keys, order, and placeholders in zh, en, and ar', () => {
    const files = sourceFiles()
    // Guard the discovery itself: an empty or narrowed sweep would pass every
    // assertion below while checking nothing.
    expect(files.length).toBeGreaterThan(500)

    // Pair within a file first; a dictionary whose counterparts are not in
    // the same module then pair with siblings in the same directory. Both
    // shapes ship here: `locales/settings.ts` exports zh+en+ar together, while
    // `locales/zh.ts` + `locales/en.ts` + `locales/ar.ts` split the common
    // dictionaries across files.
    const perFile = new Map<string, Dictionary[]>()
    for (const file of files) {
      const dicts = dictionariesIn(file)
      if (dicts.length > 0) perFile.set(relative(file), dicts)
    }

    const groups = new Map<string, Map<Locale, Dictionary>>()
    const place = (key: string, locale: Locale, dict: Dictionary): void => {
      const slot = groups.get(key) ?? new Map<Locale, Dictionary>()
      if (slot.has(locale)) {
        throw new Error(`two ${locale} dictionaries claim group ${key}: ${slot.get(locale)?.file} and ${dict.file}`)
      }
      slot.set(locale, dict)
      groups.set(key, slot)
    }

    for (const [rel, dicts] of perFile) {
      for (const dict of dicts) {
        const parsed = localeOf(dict.name)
        if (parsed === undefined) continue
        const sameFileCounterpart = dicts.some((other) => {
          const otherParsed = localeOf(other.name)
          return otherParsed !== undefined
            && otherParsed.pair === parsed.pair
            && otherParsed.locale !== parsed.locale
        })
        // Same-file groups key by file so two groups in one directory stay
        // distinct; split groups key by directory so siblings meet.
        const key = sameFileCounterpart ? `${rel}::${parsed.pair}` : `${dirname(rel)}::${parsed.pair}`
        place(key, parsed.locale, dict)
      }
    }

    const problems: string[] = []
    let comparedTriples = 0
    for (const [key, slot] of [...groups].sort()) {
      const base = slot.get('zh')
      if (base === undefined) {
        const present = [...slot.values()][0]
        problems.push(`${present?.file} declares ${present?.name} with no zh counterpart for group ${key}`)
        continue
      }
      if (!LOCALES.every(locale => slot.has(locale))) {
        const absent = LOCALES.filter(locale => !slot.has(locale))
        problems.push(`${base.file} declares ${base.name} with no ${absent.join('/')} counterpart for group ${key}`)
      } else {
        comparedTriples++
      }
      for (const locale of LOCALES) {
        if (locale === 'zh') continue
        const other = slot.get(locale)
        if (other === undefined) continue
        problems.push(...departuresFrom(base, other))
      }
    }

    // The shipped dictionary count only grows; a collapse means discovery or
    // pairing broke, which would hide real asymmetry.
    expect(comparedTriples).toBeGreaterThan(25)
    expect(problems).toEqual([])
  })
})
