/**
 * Expansion of one manifest's `launch.headless` template into the spawned
 * argument vector.
 *
 * The placeholder grammar lives in `@greeneek/gnk-craft/launch-template` and is
 * enforced at manifest load; expansion re-runs the same scan before
 * substituting so a stale template raises `CRAFT_MANIFEST_INVALID` before the
 * provider writes the token file or spawns. After the scan, every braced name
 * is one of the value keys, so substitution is a pure token mapping.
 * @module @greeneek/gnk-craft-local/launch
 */

import { CraftError, headlessTemplateViolations } from '@greeneek/gnk-craft'

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
  options: { readonly requireControlToken?: boolean } = {},
): readonly string[] {
  const violations = headlessTemplateViolations(template, options.requireControlToken ?? true)
  if (violations.length > 0) refuse(values.app, violations.join('; '))
  return template.trim().split(/\s+/).map(token =>
    // The grammar probe refused unknown placeholders, so every braced name is
    // one of the four substitutable keys.
    token.replace(/\{([^{}]*)\}/g, (_, name: string) => values[name as keyof Omit<HeadlessLaunchValues, 'app'>]))
}

/**
 * Raise one template failure.
 * @param app - display name used in the message.
 * @param detail - what the template got wrong.
 */
function refuse(app: string, detail: string): never {
  throw new CraftError(`invalid ${app} headless launch template: it ${detail}`, 'CRAFT_MANIFEST_INVALID')
}
