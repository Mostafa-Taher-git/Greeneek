/**
 * Grammar of one manifest `launch.headless` template.
 *
 * The template is whitespace-separated tokens carrying the `{cli}`,
 * `{readRoot}`, `{writeRoot}`, and `{controlTokenFile}` placeholders. It has no
 * quoting facility because substitution happens after tokenization, so a
 * substituted path may contain spaces. `{cli}` must open the template, and the
 * two roots plus the token file must all appear: the confined roots and the
 * per-launch control token are the session's security invariants, not optional
 * flags. Manifest loading refuses a nonconformant template, and argv expansion
 * re-runs the same grammar before substituting so a stale template fails loud
 * instead of producing a session that never answers.
 * @module @greeneek/gnk-craft/launch-template
 */

/** One placeholder the headless launch template grammar defines. */
export type HeadlessLaunchTemplatePlaceholder = 'cli' | 'readRoot' | 'writeRoot' | 'controlTokenFile'

/** Every placeholder name the grammar accepts. */
export const HEADLESS_LAUNCH_PLACEHOLDERS: readonly HeadlessLaunchTemplatePlaceholder[] =
  ['cli', 'readRoot', 'writeRoot', 'controlTokenFile']

/** Placeholders no template may omit; `cli` is required as the opening token instead. */
const REQUIRED: readonly HeadlessLaunchTemplatePlaceholder[] = ['readRoot', 'writeRoot', 'controlTokenFile']

/**
 * Scan one headless launch template against the placeholder grammar.
 * @param template - manifest `launch.headless` value.
 * @returns every violation in reading order, phrased to follow "it"; empty when conformant.
 */
export function headlessTemplateViolations(template: string): readonly string[] {
  const trimmed = template.trim()
  if (trimmed === '') return ['is empty']
  const violations: string[] = []
  const tokens = trimmed.split(/\s+/)
  if (tokens[0] !== '{cli}') {
    violations.push(`must open with {cli}, got ${JSON.stringify(tokens[0])}`)
  }
  const seen = new Set<HeadlessLaunchTemplatePlaceholder>()
  for (const token of tokens) {
    scanToken(token, violations, seen)
  }
  for (const name of REQUIRED) {
    if (!seen.has(name)) violations.push(`must reference {${name}}`)
  }
  return violations
}

/**
 * Scan one template token for placeholder, brace, and unknown-name violations.
 * @param token - one whitespace-delimited template token.
 * @param violations - collector updated in place.
 * @param seen - placeholder names encountered so far.
 */
function scanToken(
  token: string,
  violations: string[],
  seen: Set<HeadlessLaunchTemplatePlaceholder>,
): void {
  let cursor = 0
  while (cursor < token.length) {
    const open = token.indexOf('{', cursor)
    if (open < 0) {
      if (token.slice(cursor).includes('}')) {
        violations.push(`has an unpaired brace in ${JSON.stringify(token)}`)
      }
      return
    }
    if (open > cursor && token.slice(cursor, open).includes('}')) {
      violations.push(`has an unpaired brace in ${JSON.stringify(token)}`)
    }
    const close = token.indexOf('}', open + 1)
    if (close < 0) {
      violations.push(`has an unclosed brace in ${JSON.stringify(token)}`)
      return
    }
    const name = token.slice(open + 1, close)
    const placeholder = HEADLESS_LAUNCH_PLACEHOLDERS.find(candidate => candidate === name)
    if (placeholder === undefined) {
      violations.push(`has the unknown placeholder {${name}} in ${JSON.stringify(token)}`)
    } else {
      seen.add(placeholder)
    }
    cursor = close + 1
  }
}
