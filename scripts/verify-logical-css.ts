/**
 * Reject directional physical CSS in client stylesheets.
 *
 * The shell sets `<html dir="rtl">` for Arabic, so every direction-sensitive
 * declaration must use logical properties (`margin-inline-start`,
 * `inset-inline-end`, `text-align: start`, …) or live under an explicit
 * `[dir='rtl']` override for the physical axes CSS cannot express
 * (`transform: translateX`, `box-shadow` offsets, background positions).
 * Physical `left:`/`right:` insets, the renamed directional properties, the
 * asymmetric horizontal shorthand forms, and transition lists that name a
 * renamed property all reintroduce LTR-only geometry and fail here.
 * Scale, time-axis, and code domains (charts, sliders, terminals, JSON, diffs)
 * keep physical geometry behind a forced `direction: ltr` scope, admitted by
 * the per-file allowlist.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Physical declarations that stay because their position is not a reading
 * edge: a reading-direction-independent center, a coordinate a script
 * computes from pointer or layout measurements, or geometry inside a
 * component whose root forces `direction: ltr`.
 */
const PHYSICAL_OFFSET_ALLOWLIST = new Map<string, string>([
  ['packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css', 'tooltip centering: left 50% is direction-neutral'],
  ['packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', 'chat width handles track the pointer side of a centered column; the side is physical by contract'],
  ['packages/client/ui-layout/src/client/AppFrame.module.css', 'splitter handles center on their strip; the offset rides a TSX inline left computed from layout'],
  ['packages/client/ui-model-selection/src/client/ModelSelect.module.css', 'effort slider forces direction ltr: the knob encodes a scale fraction, not reading direction'],
  ['packages/client/ui-primitives/src/DiffBlock.module.css', 'diffs are code: the block forces direction ltr and keeps physical geometry'],
  ['packages/client/ui-primitives/src/JsonTree.module.css', 'JSON keys and values are LTR technical content: the tree forces direction ltr'],
  ['packages/client/ui-primitives/src/Menu.module.css', 'portal menus receive viewport coordinates from Menu.tsx, so the base rule only neutralizes left'],
  ['packages/client/ui-primitives/src/TerminalBlock.module.css', 'terminal output is LTR technical content: the block forces direction ltr'],
  ['packages/client/ui-primitives/src/Toast.module.css', 'anchorless fallback centers the toast; an anchored toast is positioned by TSX inline left'],
  ['packages/client/ui-trajectory/src/client/TrajectoryTimeline.module.css', 'the timeline encodes time on a left-to-right axis and forces direction ltr; physical offsets are time coordinates'],
])

/** Directional margin/padding/border properties with a logical successor. */
const DIRECTED_PROPERTIES = new Map<string, string>([
  ['margin-left', 'margin-inline-start'],
  ['margin-right', 'margin-inline-end'],
  ['padding-left', 'padding-inline-start'],
  ['padding-right', 'padding-inline-end'],
  ['border-left', 'border-inline-start'],
  ['border-right', 'border-inline-end'],
  ['border-left-color', 'border-inline-start-color'],
  ['border-left-style', 'border-inline-start-style'],
  ['border-left-width', 'border-inline-start-width'],
  ['border-right-color', 'border-inline-end-color'],
  ['border-right-style', 'border-inline-end-style'],
  ['border-right-width', 'border-inline-end-width'],
])

/** Shorthands whose four-value horizontal asymmetry the gate rejects. */
const DIRECTIONAL_SHORTHANDS = new Set(['margin', 'padding', 'inset'])

/** Transition-list items naming a property the migration renamed. */
const DIRECTED_TRANSITION_NAME = /^(left|right|(margin|padding|border)-(left|right)(-(width|color|style))?)$/

const CSS_PATTERNS = ['packages/client/**/*.css']

const CSS_EXCLUDES = ['**/node_modules/**', '**/lib/**', '**/dist/**', '**/coverage/**']

interface Violation {
  readonly path: string
  readonly line: number
  readonly message: string
}

/**
 * Split a declaration value into top-level tokens, keeping parenthesized
 * functions such as `calc(...)` as single tokens.
 */
function topLevelValues(raw: string): string[] {
  const values: string[] = []
  let current = ''
  let depth = 0
  for (const character of raw) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth === 0 && /\s/.test(character)) {
      if (current !== '') values.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current !== '') values.push(current)
  return values
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
}

/** One `{ ... }` block with the selector chain that reaches it. */
interface CssBlock {
  /** The accumulated non-@rule preludes, outermost first. */
  readonly selectorChain: string[]
  readonly open: number
  readonly close: number
}

/**
 * Parse every block with its selector chain and matching brace.
 * @param source - comment-stripped CSS text.
 */
function parseBlocks(source: string): CssBlock[] {
  const matches = new Map<number, number>()
  const stack: number[] = []
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') stack.push(index)
    if (character === '}') {
      const open = stack.pop()
      if (open === undefined) throw new Error(`verify-logical-css: unbalanced '}' at offset ${index}`)
      matches.set(open, index)
    }
  }
  if (stack.length > 0) throw new Error(`verify-logical-css: unbalanced '{' at offset ${stack[stack.length - 1]}`)
  const preludes = new Map<number, string>()
  let preludeStart = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') {
      preludes.set(index, source.slice(preludeStart, index).trim())
      preludeStart = index + 1
    }
    if (source[index] === '}') preludeStart = index + 1
  }
  const blocks: CssBlock[] = []
  const chain: string[] = []
  const walk = (open: number): void => {
    const prelude = preludes.get(open) ?? ''
    if (!prelude.startsWith('@')) chain.push(prelude)
    const close = matches.get(open)
    if (close === undefined) throw new Error(`verify-logical-css: unmatched block at offset ${open}`)
    blocks.push({ selectorChain: [...chain], open, close })
    for (let index = open + 1; index < close; index += 1) {
      if (source[index] === '{') {
        walk(index)
        const nestedClose = matches.get(index)
        if (nestedClose === undefined) throw new Error(`verify-logical-css: unmatched block at offset ${index}`)
        index = nestedClose
      }
    }
    if (!prelude.startsWith('@')) chain.pop()
  }
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') {
      walk(index)
      const close = matches.get(index)
      if (close === undefined) break
      index = close
    }
  }
  return blocks
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') line += 1
  }
  return line
}

/** Declarations a block owns directly, excluding nested blocks. */
function ownedDeclarations(source: string, block: CssBlock): Array<{ offset: number; text: string }> {
  const nested: Array<{ open: number; close: number }> = []
  for (let index = block.open + 1; index < block.close; index += 1) {
    if (source[index] === '{') nested.push({ open: index, close: matchesOf(source, index) })
  }
  const segments: Array<[number, number]> = []
  let start = block.open + 1
  for (const { open, close } of nested) {
    segments.push([start, open])
    start = close + 1
  }
  segments.push([start, block.close])
  const declarations: Array<{ offset: number; text: string }> = []
  let depth = 0
  let currentStart = -1
  for (const [segmentStart, segmentEnd] of segments) {
    for (let index = segmentStart; index < segmentEnd; index += 1) {
      const character = source[index]
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      if (character === ';' && depth === 0) {
        if (currentStart < 0) currentStart = segmentStart
        const text = source.slice(currentStart, index)
        if (text.trim() !== '') declarations.push({ offset: currentStart, text })
        currentStart = -1
      } else if (currentStart < 0 && character !== ' ' && character !== '\n' && character !== '\t' && character !== '\r') {
        currentStart = index
      }
    }
    if (currentStart >= 0) {
      const text = source.slice(currentStart, segmentEnd)
      if (text.trim() !== '') declarations.push({ offset: currentStart, text })
      currentStart = -1
    }
  }
  return declarations
}

function matchesOf(source: string, open: number): number {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error(`verify-logical-css: unmatched '{' at offset ${open}`)
}

function declarationViolations(
  path: string,
  line: number,
  selector: string,
  property: string,
  value: string,
): Violation[] {
  const directedProperty = DIRECTED_PROPERTIES.get(property)
  if (directedProperty !== undefined) {
    return [{ path, line, message: `${property}: rename to the logical ${directedProperty} property` }]
  }
  if (property === 'text-align' && /^(left|right)\b/.test(value)) {
    return [{ path, line, message: `text-align: ${value}: use start or end` }]
  }
  if (property === 'left' || property === 'right') {
    const logical = property === 'left' ? 'inset-inline-start' : 'inset-inline-end'
    const prefix = selector === '' ? '' : `${selector}: `
    return [{
      path,
      line,
      message: `${prefix}${property}: use ${logical}, or the per-file allowlist for direction-neutral geometry`,
    }]
  }
  if (property === 'transition' || property === 'transition-property') {
    const violations: Violation[] = []
    for (const item of value.split(',')) {
      const name = topLevelValues(item)[0] ?? ''
      if (DIRECTED_TRANSITION_NAME.test(name)) {
        violations.push({ path, line, message: `${property}: ${name}: name the logical property` })
      }
    }
    return violations
  }
  if (DIRECTIONAL_SHORTHANDS.has(property)) {
    const values = topLevelValues(value)
    if (values.length === 4 && values[1] !== values[3]) {
      return [{
        path,
        line,
        message: `${property}: ${value}: horizontal values differ; write block/inline longhands`,
      }]
    }
  }
  return []
}

/**
 * Find directional physical CSS below a repository root.
 * @param root - repository or test-fixture root.
 * @param allowlist - per-file reasons admitting physical offsets and the
 *   transition lists that animate them; tests inject a fixture allowlist.
 * @returns deterministic path-qualified violations.
 */
export function logicalCssViolations(
  root: string,
  allowlist: ReadonlyMap<string, string> = PHYSICAL_OFFSET_ALLOWLIST,
): string[] {
  const files = globSync(CSS_PATTERNS, { cwd: root, exclude: CSS_EXCLUDES }).sort()
  if (files.length === 0) throw new Error('verify-logical-css: the client CSS corpus is empty')
  const violations: Violation[] = []
  for (const rawPath of files) {
    const path = rawPath.replaceAll('\\', '/')
    const source = stripComments(readFileSync(resolve(root, path), 'utf8'))
    const fileAllowlisted = allowlist.has(path)
    for (const block of parseBlocks(source)) {
      const rtlOverride = block.selectorChain.some(selector => /\[\s*dir\s*=\s*(['"])rtl\1\s*\]/i.test(selector))
      const selector = block.selectorChain.join(' ')
      for (const { offset, text } of ownedDeclarations(source, block)) {
        const colon = text.indexOf(':')
        if (colon <= 0) continue
        const property = text.slice(0, colon).trim().toLowerCase()
        const value = text.slice(colon + 1).trim()
        const found = declarationViolations(path, lineOf(source, offset), selector, property, value)
        if (found.length === 0) continue
        const physicalOffset = property === 'left' || property === 'right'
        const excusable = physicalOffset || property === 'transition' || property === 'transition-property'
        if (physicalOffset && rtlOverride) continue
        if (excusable && fileAllowlisted) continue
        violations.push(...found)
      }
    }
  }
  return violations.map(({ path, line, message }) => `${path}:${line}: ${message}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..')
  const failures = logicalCssViolations(root)
  if (failures.length > 0) {
    console.error('verify-logical-css: directional physical CSS:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log('verify-logical-css: client CSS carries no unadmitted directional physical geometry.')
  }
}
