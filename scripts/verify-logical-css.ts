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
 * a per-declaration allowlist entry.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** One exact declaration a stylesheet may keep on a physical axis. */
export interface PhysicalAdmission {
  /** Whitespace-normalized selector chain of the rule that owns the declaration. */
  readonly selector: string
  /** The physical declaration the rule may keep. */
  readonly property: 'left' | 'right' | 'transition' | 'transition-property'
}

/** The declarations one stylesheet admits, and why none is a reading edge. */
export interface PhysicalAllowance {
  readonly reason: string
  readonly declarations: readonly PhysicalAdmission[]
}

/**
 * Physical declarations that stay because their position is not a reading
 * edge: a reading-direction-independent center, a coordinate a script
 * computes from pointer or layout measurements, or geometry inside a
 * component whose root forces `direction: ltr`. Each entry admits one
 * declaration; a new physical offset in an admitted file fails until it gets
 * its own entry, and an entry that matches nothing fails as stale.
 */
const PHYSICAL_OFFSET_ALLOWLIST = new Map<string, PhysicalAllowance>([
  ['packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css', {
    reason: 'tooltip centering: left 50% is direction-neutral',
    declarations: [{ selector: '.iconButton::after', property: 'left' }],
  }],
  ['packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', {
    reason: 'chat width handles track the pointer side of a centered column; the side is physical by contract',
    declarations: [
      { selector: ".widthHandle[data-side='left']", property: 'right' },
      { selector: ".widthHandle[data-side='right']", property: 'left' },
      { selector: ".widthHandle[data-side='left']::after", property: 'right' },
      { selector: ".widthHandle[data-side='right']::after", property: 'left' },
    ],
  }],
  ['packages/client/ui-layout/src/client/AppFrame.module.css', {
    reason: 'splitter handles center on their strip; the offset rides a TSX inline left computed from layout',
    declarations: [
      { selector: '.handle', property: 'transition' },
      { selector: ".handle[data-side='details']::after", property: 'left' },
    ],
  }],
  ['packages/client/ui-model-selection/src/client/ModelSelect.module.css', {
    reason: 'effort slider forces direction ltr: the knob encodes a scale fraction, not reading direction',
    declarations: [{ selector: '.sliderKnob', property: 'transition' }],
  }],
  ['packages/client/ui-primitives/src/DiffBlock.module.css', {
    reason: 'diffs are code: the block forces direction ltr and keeps physical geometry',
    declarations: [{ selector: '.copyButton', property: 'right' }],
  }],
  ['packages/client/ui-primitives/src/JsonTree.module.css', {
    reason: 'JSON keys and values are LTR technical content: the tree forces direction ltr',
    declarations: [{ selector: '.expander', property: 'left' }],
  }],
  ['packages/client/ui-primitives/src/Menu.module.css', {
    reason: 'portal menus receive viewport coordinates from Menu.tsx, so the base rule only neutralizes left',
    declarations: [{ selector: '.portal', property: 'left' }],
  }],
  ['packages/client/ui-primitives/src/TerminalBlock.module.css', {
    reason: 'terminal output is LTR technical content: the block forces direction ltr',
    declarations: [{ selector: '.runState', property: 'left' }],
  }],
  ['packages/client/ui-primitives/src/Toast.module.css', {
    reason: 'anchorless fallback centers the toast; an anchored toast is positioned by TSX inline left',
    declarations: [{ selector: '.toast', property: 'left' }],
  }],
  ['packages/client/ui-trajectory/src/client/TrajectoryTimeline.module.css', {
    reason: 'the timeline encodes time on a left-to-right axis and forces direction ltr; physical offsets are time coordinates',
    declarations: [
      { selector: '.labels span', property: 'right' },
      { selector: '.earlierHistory', property: 'left' },
      { selector: '.empty', property: 'left' },
      { selector: '.lanes', property: 'left' },
      { selector: '.turnBoundaries', property: 'left' },
      { selector: ".lanes[data-animate-viewport='true'], .turnBoundaries[data-animate-viewport='true']", property: 'transition' },
      { selector: '.turnBoundary', property: 'left' },
      { selector: '.span', property: 'left' },
      { selector: '.selection', property: 'left' },
      { selector: '.selectionEdges', property: 'left' },
      { selector: '.hoverLine', property: 'left' },
      { selector: '.selectionEdges::before', property: 'left' },
      { selector: '.selectionEdges::after', property: 'right' },
    ],
  }],
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

const CSS_PATTERNS = ['packages/client/**/*.css', 'packages/*/*/src/client/**/*.css']

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

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim()
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
      message: `${prefix}${property}: use ${logical}, or record this declaration in the gate allowlist`,
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
 * @param allowlist - per-file admissions naming the selector and property each
 *   entry excuses; every entry must match a declaration in the corpus. Tests
 *   inject a fixture allowlist.
 * @returns deterministic path-qualified violations.
 */
export function logicalCssViolations(
  root: string,
  allowlist: ReadonlyMap<string, PhysicalAllowance> = PHYSICAL_OFFSET_ALLOWLIST,
): string[] {
  const files = globSync(CSS_PATTERNS, { cwd: root, exclude: CSS_EXCLUDES }).sort()
  if (files.length === 0) throw new Error('verify-logical-css: the client CSS corpus is empty')
  const violations: Violation[] = []
  const admitted = new Set<string>()
  const admissionKey = (path: string, selector: string, property: string): string => `${path}\u0000${selector}\u0000${property}`
  for (const rawPath of files) {
    const path = rawPath.replaceAll('\\', '/')
    const source = stripComments(readFileSync(resolve(root, path), 'utf8'))
    const admissions = allowlist.get(path)?.declarations ?? []
    for (const block of parseBlocks(source)) {
      const rtlOverride = block.selectorChain.some(selector => /\[\s*dir\s*=\s*(['"])rtl\1\s*\]/i.test(selector))
      const selector = normalizeSelector(block.selectorChain.join(' '))
      for (const { offset, text } of ownedDeclarations(source, block)) {
        const colon = text.indexOf(':')
        if (colon <= 0) continue
        const property = text.slice(0, colon).trim().toLowerCase()
        const value = text.slice(colon + 1).trim()
        const found = declarationViolations(path, lineOf(source, offset), selector, property, value)
        if (found.length === 0) continue
        if (property === 'left' || property === 'right') {
          if (rtlOverride) continue
          if (admissions.some(admission => admission.selector === selector && admission.property === property)) {
            admitted.add(admissionKey(path, selector, property))
            continue
          }
        } else if (property === 'transition' || property === 'transition-property') {
          if (admissions.some(admission => admission.selector === selector && admission.property === property)) {
            admitted.add(admissionKey(path, selector, property))
            continue
          }
        }
        violations.push(...found)
      }
    }
  }
  for (const [path, allowance] of allowlist) {
    if (allowance.reason.trim() === '') throw new Error(`verify-logical-css: allowlist entry ${path} has no reason`)
    if (allowance.declarations.length === 0) throw new Error(`verify-logical-css: allowlist entry ${path} admits no declaration`)
    for (const admission of allowance.declarations) {
      if (!admitted.has(admissionKey(path, admission.selector, admission.property))) {
        throw new Error(`verify-logical-css: allowlist entry ${path} ${admission.selector} ${admission.property} matched no physical declaration`)
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
