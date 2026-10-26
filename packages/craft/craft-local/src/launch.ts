/**
 * Expansion of one manifest's `launch.headless` template into the spawned
 * argument vector.
 *
 * The template is whitespace-separated tokens carrying the `{cli}`,
 * `{readRoot}`, `{writeRoot}`, and `{controlTokenFile}` placeholders. It has no
 * quoting facility because substitution happens after tokenization, so a
 * substituted path may contain spaces. `{cli}` must open the template, and the
 * two roots plus the token file must all appear: the confined roots and the
 * per-launch control token are the session's security invariants, not optional
 * flags. A refused template raises `CRAFT_MANIFEST_INVALID` before the provider
 * writes the token file or spawns, so a stale template fails loud instead of
 * producing a session that never answers.
 * @module @greeneek/gnk-craft-local/launch
 */

import { CraftError } from '@greeneek/gnk-craft'

/** One placeholder the headless template grammar defines. */
export type HeadlessLaunchPlaceholder = 'cli' | 'readRoot' | 'writeRoot' | 'controlTokenFile'

/** Every accepted placeholder name. */
const PLACEHOLDERS: readonly HeadlessLaunchPlaceholder[] = ['cli', 'readRoot', 'writeRoot', 'controlTokenFile']

/** Placeholders no template may omit; `cli` is required as the opening token instead. */
const REQUIRED: readonly HeadlessLaunchPlaceholder[] = ['readRoot', 'writeRoot', 'controlTokenFile']

/** Values one headless launch template may reference. */
export interface HeadlessLaunchValues {
  /** Display name used in diagnostics. */
  readonly app: string
  /** Absolute CLI path substituted for `{cli}`. */
  readonly cli: string
  /** Confined read root substituted for `{readRoot}`. */
  readonly readRoot: string
  /** Confined write root substituted for `{writeRoot}`. */
  readonly writeRoot: string
  /** Per-launch control-token file substituted for `{controlTokenFile}`. */
  readonly controlTokenFile: string
}

/**
 * Expand one headless template into argv.
 * @param template - manifest `launch.headless` value.
 * @param values - executable path and confined job facts.
 * @returns the argument vector, `argv[0]` being the absolute CLI.
 */
export function expandHeadlessLaunch(
  template: string,
  values: HeadlessLaunchValues,
): readonly string[] {
  const trimmed = template.trim()
  if (trimmed === '') refuse(values.app, 'is empty')
  const tokens = trimmed.split(/\s+/)
  if (tokens[0] !== '{cli}') {
    refuse(values.app, `must open with {cli}, got ${JSON.stringify(tokens[0])}`)
  }
  const seen = new Set<HeadlessLaunchPlaceholder>()
  const argv = tokens.map(token => expandToken(token, values, seen))
  for (const name of REQUIRED) {
    if (!seen.has(name)) refuse(values.app, `must reference {${name}}`)
  }
  return argv
}

/**
 * Substitute every placeholder of one token.
 * @param token - one whitespace-delimited template token.
 * @param values - executable path and confined job facts.
 * @param seen - placeholder names encountered so far, updated in place.
 * @returns the token with every placeholder replaced.
 */
function expandToken(
  token: string,
  values: HeadlessLaunchValues,
  seen: Set<HeadlessLaunchPlaceholder>,
): string {
  let text = ''
  let cursor = 0
  while (cursor < token.length) {
    const open = token.indexOf('{', cursor)
    if (open < 0) {
      text += literal(token.slice(cursor), token, values.app)
      return text
    }
    text += literal(token.slice(cursor, open), token, values.app)
    const close = token.indexOf('}', open + 1)
    if (close < 0) refuse(values.app, `has an unclosed brace in ${JSON.stringify(token)}`)
    text += placeholderValue(token.slice(open + 1, close), token, values, seen)
    cursor = close + 1
  }
  return text
}

/**
 * Return one literal run, refusing a brace that no placeholder opened.
 * @param run - literal text between placeholders.
 * @param token - whole token, used in the diagnostic.
 * @param app - display name used in the diagnostic.
 * @returns the literal run.
 */
function literal(run: string, token: string, app: string): string {
  if (run.includes('}')) refuse(app, `has an unpaired brace in ${JSON.stringify(token)}`)
  return run
}

/**
 * Resolve one placeholder name to its value.
 * @param name - text between the braces.
 * @param token - whole token, used in the diagnostic.
 * @param values - executable path and confined job facts.
 * @param seen - placeholder names encountered so far, updated in place.
 * @returns the substituted value.
 */
function placeholderValue(
  name: string,
  token: string,
  values: HeadlessLaunchValues,
  seen: Set<HeadlessLaunchPlaceholder>,
): string {
  const placeholder = PLACEHOLDERS.find(candidate => candidate === name)
  if (placeholder === undefined) {
    refuse(values.app, `has the unknown placeholder {${name}} in ${JSON.stringify(token)}`)
  }
  seen.add(placeholder)
  return values[placeholder]
}

/**
 * Raise one template failure.
 * @param app - display name used in the message.
 * @param detail - what the template got wrong.
 */
function refuse(app: string, detail: string): never {
  throw new CraftError(`invalid ${app} headless launch template: it ${detail}`, 'CRAFT_MANIFEST_INVALID')
}
