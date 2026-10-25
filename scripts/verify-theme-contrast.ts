/**
 * Compute WCAG 2.x contrast for every light-theme role from the token values in
 * `packages/client/ui-theme/src/styles/design-platform.css` and reject a role
 * that falls below its target on a surface the shipped CSS paints under it.
 *
 * Colour is read from the stylesheet, never restated here: only the role to
 * surface pairing and its target live in this file. A renamed or removed token,
 * a value this parser cannot resolve, and a surface with no reachable pairing
 * all fail the gate instead of being skipped.
 *
 * Scope is the neutral label family, the brand/business accent, the inverted
 * and foreground pairings, and the non-text focus, selection, and scrollbar
 * affordances. Signal hues (`state-success-*`, `state-warn-*`, `state-error-*`)
 * are outside this table: their hue is pinned by the light-appearance decision,
 * and a change there needs keyed browser-snapshot re-recording.
 * TODO(theme-contrast): cover signal-state text once the owner decides the
 * success/warn/error ladder; diff add and delete lines are its worst cases.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** One sRGB channel triple in 0–255. */
export interface Rgb {
  readonly red: number
  readonly green: number
  readonly blue: number
}

/** One sRGB colour with its alpha, the parsed form of every CSS colour value. */
export interface Rgba extends Rgb {
  readonly alpha: number
}

/** A surface a role is painted over: one token, plus the solid token beneath it
 * when that token carries alpha. */
export interface Surface {
  readonly token: string
  readonly over?: string
}

/** One asserted role-to-surface pairing. */
export interface ContrastCheck {
  /** Role as it reads in a WCAG report. */
  readonly role: string
  /** Interaction state the pairing renders. */
  readonly state: 'default' | 'hover' | 'selected' | 'focus' | 'placeholder' | 'disabled'
  /** Token whose colour carries the role. */
  readonly foreground: string
  /** Surfaces the shipped CSS paints under this role. */
  readonly surfaces: readonly Surface[]
  /** WCAG 2.x minimum: 4.5 for normal-size text, 3 for large text and non-text. */
  readonly target: number
  /** Font size and weight the shipped CSS assigns the role, which selects `target`. */
  readonly basis: string
}

/** One measured shortfall, formatted by {@link formatViolations}. */
export interface Violation {
  readonly check: ContrastCheck
  readonly surface: Surface
  readonly foreground: string
  readonly background: string
  readonly ratio: number
}

/** WCAG AA minimum for normal-size text. */
const NORMAL_TEXT_TARGET = 4.5

/** WCAG AA minimum for large text, and the SC 1.4.11 minimum for non-text UI. */
const MINIMUM_CONTRAST_TARGET = 3

/** Surfaces named once so each check lists pairings instead of token strings. */
const SURFACES = {
  base: { token: '--dsw-alias-bg-base' },
  layer1: { token: '--dsw-alias-bg-layer-1' },
  layer2: { token: '--dsw-alias-bg-layer-2' },
  layer3: { token: '--dsw-alias-bg-layer-3' },
  overlay: { token: '--dsw-alias-bg-overlay' },
  menu: { token: '--dsw-specific-menu' },
  inputMajor: { token: '--dsw-specific-input-major' },
  elevated: { token: '--dsw-alias-button-elevated-fill' },
  sidebar: { token: '--dsw-specific-sidebar-fill' },
  codeBlock: { token: '--dsw-alias-markdown-code-block' },
  codeBanner: { token: '--dsw-alias-markdown-code-block-banner' },
  inlineCode: { token: '--dsw-alias-markdown-inline-code' },
  module: { token: '--dsw-alias-bg-module-platform' },
  multiSelect: { token: '--dsw-alias-bg-multi-select' },
  bubble: { token: '--dsw-specific-bubble' },
  businessTertiary: { token: '--dsw-alias-state-business-tertiary' },
  successTertiary: { token: '--dsw-alias-state-success-tertiary' },
  warnTertiary: { token: '--dsw-alias-state-warn-tertiary' },
  hoverWash: { token: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-base' },
  selectionWash: { token: '--dsw-alias-text-selection', over: '--dsw-alias-bg-base' },
  hoverSolid: { token: '--dsw-alias-interactive-bg-hover-solid' },
  navHover: { token: '--dsw-specific-sidebar-nav-item-hover' },
  floatingHover: { token: '--dsw-alias-button-floating-hover' },
  ghostActive: { token: '--dsw-alias-button-ghost-active-fill' },
  navActive: { token: '--dsw-specific-sidebar-nav-item-active' },
  brandFill: { token: '--dsw-alias-button-primary-fill' },
  brandHover: { token: '--dsw-alias-button-primary-hover' },
  infoFill: { token: '--dsw-alias-button-info-fill' },
  contrastFill: { token: '--dsw-alias-button-contrast-fill' },
  ink: { token: '--dsw-alias-label-primary' },
  toast: { token: '--dsw-alias-toast-bg' },
  tooltip: { token: '--dsw-alias-tooltip-bg' },
  /** Every rung a scrolling region can present: the scrollbar track is
   * transparent, so the thumb reads against the surface beneath it. */
  scrollRungs: [
    { token: '--dsw-alias-bg-base' },
    { token: '--dsw-alias-bg-layer-1' },
    { token: '--dsw-alias-bg-layer-2' },
    { token: '--dsw-alias-bg-layer-3' },
    { token: '--dsw-alias-bg-overlay' },
  ] as const satisfies readonly Surface[],
  /** Every flat light surface: the four elevation rungs plus the dialog and
   * menu carriers, which resolve to the same or a lighter rung. */
  flatRungs: [
    { token: '--dsw-alias-bg-base' },
    { token: '--dsw-alias-bg-layer-1' },
    { token: '--dsw-alias-bg-layer-2' },
    { token: '--dsw-alias-bg-layer-3' },
    { token: '--dsw-alias-bg-overlay' },
    { token: '--dsw-specific-menu' },
    { token: '--dsw-specific-input-major' },
    { token: '--dsw-alias-button-elevated-fill' },
  ] as const satisfies readonly Surface[],
}

/**
 * The light-theme pairings the gate enforces, each with the typography that
 * selects its target. Every surface is one a shipped rule paints under the
 * role; a role is not asserted against a fill that never carries its text,
 * because that would force two text roles onto one value.
 */
export const LIGHT_CONTRAST_CHECKS: readonly ContrastCheck[] = [
  {
    role: '--dsw-alias-label-primary',
    state: 'default',
    foreground: '--dsw-alias-label-primary',
    surfaces: [
      ...SURFACES.flatRungs,
      SURFACES.sidebar,
      SURFACES.codeBlock,
      SURFACES.codeBanner,
      SURFACES.inlineCode,
      SURFACES.module,
      SURFACES.multiSelect,
      SURFACES.bubble,
      SURFACES.hoverWash,
      SURFACES.selectionWash,
      SURFACES.hoverSolid,
      SURFACES.navHover,
      SURFACES.floatingHover,
      SURFACES.ghostActive,
      SURFACES.navActive,
    ],
    target: NORMAL_TEXT_TARGET,
    basis: 'markdown body 14px/400 through h1 21px/700, tool and settings labels 11–16px',
  },
  {
    role: '--dsw-alias-label-primary-dimmed',
    state: 'default',
    foreground: '--dsw-alias-label-primary-dimmed',
    surfaces: [...SURFACES.flatRungs, SURFACES.hoverSolid, SURFACES.ghostActive],
    target: NORMAL_TEXT_TARGET,
    basis: 'user message and queue text 12–14px/400',
  },
  {
    role: '--dsw-alias-label-secondary',
    state: 'default',
    foreground: '--dsw-alias-label-secondary',
    surfaces: [
      ...SURFACES.flatRungs,
      SURFACES.sidebar,
      SURFACES.codeBlock,
      SURFACES.module,
      SURFACES.multiSelect,
      SURFACES.bubble,
      SURFACES.businessTertiary,
      SURFACES.successTertiary,
      SURFACES.hoverWash,
      SURFACES.hoverSolid,
      SURFACES.navHover,
      SURFACES.ghostActive,
    ],
    target: NORMAL_TEXT_TARGET,
    basis: 'boot failure detail 12px/400, `.older` pill 12px/400, row captions 13–14px/400–500',
  },
  {
    role: '--dsw-alias-label-tertiary',
    state: 'default',
    foreground: '--dsw-alias-label-tertiary',
    surfaces: [
      ...SURFACES.flatRungs,
      SURFACES.sidebar,
      SURFACES.codeBlock,
      SURFACES.module,
      SURFACES.bubble,
      SURFACES.hoverWash,
    ],
    target: NORMAL_TEXT_TARGET,
    basis: 'input icons 16px/400, hint and diff gap lines 11–13px/400; no rule paints it on the #DADADA solid hover fill',
  },
  {
    role: '--dsw-alias-label-caption',
    state: 'default',
    foreground: '--dsw-alias-label-caption',
    surfaces: [
      ...SURFACES.flatRungs,
      SURFACES.codeBanner,
      SURFACES.hoverWash,
    ],
    target: NORMAL_TEXT_TARGET,
    basis: 'turn status 11–14px/400, row and file-tree captions 11–13px/400 — all normal-size text',
  },
  {
    role: '--dsw-alias-label-dimmed',
    state: 'placeholder',
    foreground: '--dsw-alias-label-dimmed',
    // One token carries both roles, so both are asserted: placeholder text sits
    // in an active field and owes SC 1.4.3 the full normal-text target. The
    // accent hover wash is absent because `.trigger:hover:not(:disabled)` and
    // `:disabled` cannot match one element, and every `::placeholder` host
    // paints a flat rung.
    surfaces: SURFACES.flatRungs,
    target: NORMAL_TEXT_TARGET,
    basis: 'Input/HeroShell/WorkspaceBrowser `::placeholder` 12–14px/400 in an active field',
  },
  {
    role: '--dsw-alias-label-dimmed',
    state: 'disabled',
    foreground: '--dsw-alias-label-dimmed',
    surfaces: [...SURFACES.flatRungs],
    target: NORMAL_TEXT_TARGET,
    basis: ':disabled trigger and option text 12–14px/400; SC 1.4.3 exempts inactive components, the repo floor is the text target',
  },
  {
    role: '--dsw-alias-label-primary-bluish',
    state: 'default',
    foreground: '--dsw-alias-label-primary-bluish',
    surfaces: [
      ...SURFACES.flatRungs,
      SURFACES.bubble,
      SURFACES.businessTertiary,
    ],
    target: NORMAL_TEXT_TARGET,
    basis: 'hero wordmark text at the base font size',
  },
  {
    role: '--dsw-alias-state-business-primary',
    state: 'default',
    foreground: '--dsw-alias-state-business-primary',
    surfaces: [
      ...SURFACES.flatRungs,
      SURFACES.sidebar,
      SURFACES.module,
      SURFACES.bubble,
      SURFACES.businessTertiary,
      SURFACES.hoverWash,
    ],
    target: NORMAL_TEXT_TARGET,
    basis: 'markdown links 14px/400, chip and composer accent text 12–14px/400',
  },
  {
    role: '--dsw-alias-label-primary-foreground',
    state: 'default',
    foreground: '--dsw-alias-label-primary-foreground',
    surfaces: [SURFACES.brandFill, SURFACES.brandHover, SURFACES.infoFill],
    target: NORMAL_TEXT_TARGET,
    basis: 'primary and info button labels 12–14px/400–600 on brand fills',
  },
  {
    role: '--dsw-alias-label-primary-inverted',
    state: 'default',
    foreground: '--dsw-alias-label-primary-inverted',
    surfaces: [SURFACES.contrastFill, SURFACES.ink, SURFACES.toast, SURFACES.tooltip],
    target: NORMAL_TEXT_TARGET,
    basis: 'toast 14px/400, tooltip body text, attachment count badge 11px/500',
  },
  {
    role: '--dsw-alias-brand-primary',
    state: 'focus',
    foreground: '--dsw-alias-brand-primary',
    surfaces: [...SURFACES.flatRungs, SURFACES.hoverSolid],
    target: MINIMUM_CONTRAST_TARGET,
    basis: 'SC 1.4.11 non-text: `:focus-within` border and ring strokes, 0.5–2px',
  },
  {
    role: 'selected-state border',
    state: 'selected',
    foreground: '--dsw-alias-button-ghost-active-border',
    surfaces: [SURFACES.ghostActive, SURFACES.navActive],
    target: MINIMUM_CONTRAST_TARGET,
    basis: 'SC 1.4.11 non-text: the hairline that carries the selected state of ghost and pill controls',
  },
  {
    role: 'scrollbar thumb',
    state: 'default',
    foreground: '--dsw-alias-scrollbar-bg-l1',
    surfaces: SURFACES.scrollRungs,
    target: MINIMUM_CONTRAST_TARGET,
    basis: 'SC 1.4.11 non-text: the thumb is the only visual that identifies the scrollbar against a transparent track',
  },
  {
    role: 'scrollbar thumb hover',
    state: 'hover',
    foreground: '--dsw-alias-scrollbar-hover-l1',
    surfaces: SURFACES.scrollRungs,
    target: MINIMUM_CONTRAST_TARGET,
    basis: 'SC 1.4.11 non-text: `::-webkit-scrollbar-thumb:hover` replaces the resting thumb colour',
  },
  // The l2 pair is what an elevated surface (menu, popover, dialog) rebinds to
  // in scrollbar.css. It shares a step with l1 today, so asserting both aliases
  // keeps a later divergence of the elevated pair from going unnoticed.
  {
    role: 'scrollbar thumb (elevated)',
    state: 'default',
    foreground: '--dsw-alias-scrollbar-bg-l2',
    surfaces: SURFACES.scrollRungs,
    target: MINIMUM_CONTRAST_TARGET,
    basis: 'SC 1.4.11 non-text: the thumb an elevated surface repaints `--gnk-scrollbar-thumb` with',
  },
  {
    role: 'scrollbar thumb hover (elevated)',
    state: 'hover',
    foreground: '--dsw-alias-scrollbar-hover-l2',
    surfaces: SURFACES.scrollRungs,
    target: MINIMUM_CONTRAST_TARGET,
    basis: 'SC 1.4.11 non-text: the elevated hover thumb from `--gnk-scrollbar-thumb-hover`',
  },
]

/** Parses one `rgb()`/`rgba()` or `#RGB`/`#RRGGBB` literal into channels. */
function parseColorLiteral(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (hex?.[1] !== undefined) {
    const raw = hex[1].toUpperCase()
    const digits = raw.length === 3 ? raw.split('').map(digit => digit + digit).join('') : raw
    return {
      red: Number.parseInt(digits.slice(0, 2), 16),
      green: Number.parseInt(digits.slice(2, 4), 16),
      blue: Number.parseInt(digits.slice(4, 6), 16),
      alpha: 1,
    }
  }
  const functional = /^rgba?\(([^)]*)\)$/i.exec(value.trim())
  if (functional?.[1] !== undefined) {
    const parts = functional[1].split(/[,/\s]+/).filter(part => part !== '')
    if (parts.length !== 3 && parts.length !== 4) throw new Error(`unparseable colour ${JSON.stringify(value)}`)
    const [red, green, blue] = parts.slice(0, 3).map(part => Number.parseInt(part, 10))
    if (red === undefined || green === undefined || blue === undefined) {
      throw new Error(`unparseable colour ${JSON.stringify(value)}`)
    }
    const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
    for (const channel of [red, green, blue]) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        throw new Error(`channel out of range in ${JSON.stringify(value)}`)
      }
    }
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error(`alpha out of range in ${JSON.stringify(value)}`)
    return { red, green, blue, alpha }
  }
  throw new Error(`unsupported colour value ${JSON.stringify(value)}`)
}

/**
 * The declarations of every `body { … }` block, keyed by custom-property name.
 * Blocks with an attribute or pseudo-class qualifier belong to another
 * appearance and are not read here.
 * @param css - one stylesheet.
 * @returns token name to raw declaration value, in source order.
 */
export function lightBodyDeclarations(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const declarations = new Map<string, string>()
  for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const part of selector.split(',')) {
      if (part.trim() !== 'body') continue
      for (const declaration of body.split(';')) {
        const colon = declaration.indexOf(':')
        if (colon === -1) continue
        const property = declaration.slice(0, colon).trim()
        const value = declaration.slice(colon + 1).trim()
        if (property.startsWith('--')) declarations.set(property, value)
      }
    }
  }
  return declarations
}

/** The resolved colour for one token, following `var()` indirection. */
function resolveColor(name: string, declarations: Map<string, string>, seen: readonly string[]): Rgba {
  const raw = declarations.get(name)
  if (raw === undefined) throw new Error(`token ${name} is not declared in the light theme body block`)
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw)
  if (reference?.[1] === undefined) return parseColorLiteral(raw)
  const target = reference[1]
  if (seen.includes(target)) throw new Error(`token ${name} resolves through a cycle: ${[...seen, target].join(' -> ')}`)
  return resolveColor(target, declarations, [...seen, name])
}

/**
 * The light-theme token values this gate reads, every alias and static resolved
 * to channels.
 * @param css - `design-platform.css` text.
 * @returns token name to resolved colour.
 */
export function lightThemeColors(css: string): Map<string, Rgba> {
  const declarations = lightBodyDeclarations(css)
  const colors = new Map<string, Rgba>()
  for (const name of declarations.keys()) colors.set(name, resolveColor(name, declarations, []))
  return colors
}

/** WCAG 2.x relative luminance of one opaque colour. */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const linear = value / 255
    return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
}

/** WCAG 2.x contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(left: Rgb, right: Rgb): number {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a)
  const top = lighter ?? 0
  const bottom = darker ?? 0
  return (top + 0.05) / (bottom + 0.05)
}

/**
 * The colour a viewer sees where a translucent colour paints over a solid one.
 * @param foreground - the translucent colour.
 * @param background - the solid colour beneath it.
 * @returns the composited opaque colour.
 */
export function compositeOver(foreground: Rgba, background: Rgb): Rgb {
  const blend = (top: number, bottom: number): number => Math.round(top * foreground.alpha + bottom * (1 - foreground.alpha))
  return {
    red: blend(foreground.red, background.red),
    green: blend(foreground.green, background.green),
    blue: blend(foreground.blue, background.blue),
  }
}

function colorOf(colors: Map<string, Rgba>, token: string): Rgba {
  const color = colors.get(token)
  if (color === undefined) throw new Error(`token ${token} is not declared in the light theme body block`)
  return color
}

/** The solid colour one surface presents, compositing it when it carries alpha. */
export function surfaceColor(colors: Map<string, Rgba>, surface: Surface): Rgb {
  const own = colorOf(colors, surface.token)
  if (own.alpha === 1) return own
  if (surface.over === undefined) throw new Error(`surface ${surface.token} carries alpha and names no surface beneath it`)
  const beneath = colorOf(colors, surface.over)
  if (beneath.alpha !== 1) throw new Error(`surface ${surface.over} beneath ${surface.token} is itself translucent`)
  return compositeOver(own, beneath)
}

/**
 * Every pairing measured below its target.
 * @param colors - resolved light-theme token colours, from {@link lightThemeColors}.
 * @param checks - pairings to measure, {@link LIGHT_CONTRAST_CHECKS} by default.
 * @returns one entry per shortfall in table order.
 */
export function contrastViolations(
  colors: Map<string, Rgba>,
  checks: readonly ContrastCheck[] = LIGHT_CONTRAST_CHECKS,
): Violation[] {
  const violations: Violation[] = []
  for (const check of checks) {
    const foreground = colorOf(colors, check.foreground)
    for (const surface of check.surfaces) {
      const ratio = contrastRatio(foreground, surfaceColor(colors, surface))
      if (ratio < check.target) violations.push({
        check,
        surface,
        foreground: check.foreground,
        background: surface.over === undefined ? surface.token : `${surface.token} over ${surface.over}`,
        ratio,
      })
    }
  }
  return violations
}

/**
 * Renders violations as one line each, most severe first within a check.
 * @param violations - output of {@link contrastViolations}.
 * @returns report lines.
 */
export function formatViolations(violations: readonly Violation[]): string[] {
  return violations.map(violation =>
    `${violation.check.role} [${violation.check.state}] on ${violation.background}: `
    + `${violation.ratio.toFixed(2)}:1 < ${violation.check.target}:1 `
    + `(target from ${violation.check.basis})`,
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..')
  const stylesheet = 'packages/client/ui-theme/src/styles/design-platform.css'
  const colors = lightThemeColors(readFileSync(resolve(root, stylesheet), 'utf8'))
  const violations = contrastViolations(colors)
  if (violations.length > 0) {
    process.stderr.write(`verify-theme-contrast: ${String(violations.length)} light-theme role(s) below WCAG target on ${stylesheet}\n`)
    for (const line of formatViolations(violations)) process.stderr.write(`  ${line}\n`)
    process.exit(1)
  }
  const checked = LIGHT_CONTRAST_CHECKS.reduce((total, check) => total + check.surfaces.length, 0)
  process.stdout.write(
    `verify-theme-contrast: ${String(LIGHT_CONTRAST_CHECKS.length)} role(s), ${String(checked)} role/surface pairing(s) meet WCAG AA on the light theme.\n`,
  )
}
