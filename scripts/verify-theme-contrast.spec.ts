/** Light-theme contrast gate: WCAG measurement, token parsing, and the pairing table. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LIGHT_CONTRAST_CHECKS,
  compositeOver,
  contrastRatio,
  contrastViolations,
  formatViolations,
  lightBodyDeclarations,
  lightThemeColors,
  relativeLuminance,
  surfaceColor,
  type ContrastCheck,
  type Rgba,
} from './verify-theme-contrast.ts'

const STYLESHEET_RELATIVE_PATH = 'packages/client/ui-theme/src/styles/design-platform.css'

function shippedStylesheet(): string {
  return readFileSync(resolve(import.meta.dirname, '..', STYLESHEET_RELATIVE_PATH), 'utf8')
}

/** Rewrite one light-theme declaration to a fixture value, whatever it holds now. */
function withToken(css: string, token: string, value: string): string {
  const declaration = new RegExp(`^(\\s*${token}:)[^;]+;`, 'm')
  if (!declaration.test(css)) throw new Error(`fixture stylesheet has no light declaration for ${token}`)
  return css.replace(declaration, `$1 ${value};`)
}

function check(foreground: string, surface: string): ContrastCheck {
  return {
    role: foreground,
    state: 'default',
    foreground,
    surfaces: [{ token: surface }],
    target: 4.5,
    basis: 'fixture typography',
  }
}

/** Read one resolved token, failing the spec when the stylesheet stops declaring it. */
function solid(
  colors: Map<string, Rgba>,
  token: string,
): Rgba {
  const color = colors.get(token)
  if (color === undefined) throw new Error(`fixture stylesheet declares no ${token}`)
  return color
}

describe('WCAG measurement', () => {
  it('measures the extremes and a mid grey against white', () => {
    expect(relativeLuminance({ red: 255, green: 255, blue: 255 })).toBeCloseTo(1, 10)
    expect(relativeLuminance({ red: 0, green: 0, blue: 0 })).toBe(0)
    expect(contrastRatio({ red: 0, green: 0, blue: 0 }, { red: 255, green: 255, blue: 255 })).toBeCloseTo(21, 10)
    expect(contrastRatio({ red: 128, green: 128, blue: 128 }, { red: 255, green: 255, blue: 255 })).toBeCloseTo(3.95, 2)
  })

  it('composites a translucent colour over a solid one', () => {
    expect(compositeOver({ red: 0, green: 0, blue: 0, alpha: 0.5 }, { red: 255, green: 255, blue: 255 }))
      .toEqual({ red: 128, green: 128, blue: 128 })
  })

  it('rejects the same ratio measured in either colour order', () => {
    const light = { red: 238, green: 238, blue: 238 }
    const dark = { red: 103, green: 103, blue: 103 }
    expect(contrastRatio(dark, light)).toBeCloseTo(contrastRatio(light, dark), 10)
  })
})

describe('light-theme token parsing', () => {
  it('reads both light blocks and skips every qualified selector', () => {
    const colors = lightThemeColors(shippedStylesheet())
    expect(colors.get('--dsw-alias-bg-base')).toEqual({ red: 238, green: 238, blue: 238, alpha: 1 })
    expect(colors.get('--dsw-alias-bg-layer-1')).toEqual({ red: 242, green: 242, blue: 242, alpha: 1 })
    expect(colors.get('--dsw-alias-bg-layer-2')).toEqual({ red: 247, green: 247, blue: 247, alpha: 1 })
    expect(colors.get('--dsw-alias-bg-overlay')).toEqual({ red: 251, green: 251, blue: 251, alpha: 1 })
    // The dark block redeclares the same names; the light reading must survive it.
    expect(lightBodyDeclarations(shippedStylesheet()).get('--dsw-static-neutral-bluish-00'))
      .toBe('rgb(238, 238, 238)')
  })

  it('resolves alias indirection down to the static step', () => {
    const colors = lightThemeColors(shippedStylesheet())
    expect(colors.get('--dsw-alias-label-tertiary')).toEqual({ red: 98, green: 98, blue: 98, alpha: 1 })
    expect(colors.get('--dsw-alias-button-primary-fill')).toEqual({ red: 41, green: 60, blue: 48, alpha: 1 })
  })

  it('accepts each supported colour notation', () => {
    const colors = lightThemeColors(`body {
      --a: #EEEEEE;
      --b: #eee;
      --c: #EEE;
      --d: rgb(238, 238, 238);
      --e: rgba(238, 238, 238, 0.5);
    }`)
    const opaque = { red: 238, green: 238, blue: 238, alpha: 1 }
    expect(colors.get('--a')).toEqual(opaque)
    expect(colors.get('--b')).toEqual(opaque)
    expect(colors.get('--c')).toEqual(opaque)
    expect(colors.get('--d')).toEqual(opaque)
    expect(colors.get('--e')).toEqual({ red: 238, green: 238, blue: 238, alpha: 0.5 })
  })

  it('rejects a declaration it cannot resolve instead of skipping it', () => {
    expect(() => lightThemeColors('body { --a: color-mix(in oklab, red, blue); }'))
      .toThrow('unsupported colour value "color-mix(in oklab, red, blue)"')
    expect(() => lightThemeColors('body { --a: var(--b); --b: var(--a); }'))
      .toThrow(/resolves through a cycle/)
  })
})

describe('light-theme contrast gate', () => {
  it('accepts the shipped stylesheet', () => {
    expect(contrastViolations(lightThemeColors(shippedStylesheet()))).toEqual([])
  })

  it('rejects a caption step lightened back below the AA text target', () => {
    const css = withToken(shippedStylesheet(), '--dsw-static-neutral-bluish-400', 'rgb(128, 128, 128)')
    const violations = contrastViolations(lightThemeColors(css))
    expect(formatViolations(violations)[0]).toContain(
      '--dsw-alias-label-caption [default] on --dsw-alias-bg-base: 3.40:1 < 4.5:1',
    )
    expect(new Set(violations.map(violation => violation.check.role))).toEqual(new Set(['--dsw-alias-label-caption']))
  })

  it('rejects a placeholder step lightened back to the surface tone', () => {
    const css = withToken(shippedStylesheet(), '--dsw-static-neutral-bluish-200', 'rgb(196, 196, 196)')
    const violations = contrastViolations(lightThemeColors(css))
    expect(violations.map(violation => violation.check.state)).toContain('placeholder')
    expect(violations.map(violation => violation.check.state)).toContain('disabled')
  })

  it('rejects a scrollbar thumb lightened to a decorative hairline', () => {
    const css = withToken(shippedStylesheet(), '--dsw-static-neutral-200', 'rgb(196, 196, 196)')
    const violations = contrastViolations(lightThemeColors(css))
    expect(new Set(violations.map(violation => violation.check.role)))
      .toEqual(new Set(['scrollbar thumb', 'scrollbar thumb (elevated)']))
  })

  it('rejects a link colour lifted back to the brighter brand step', () => {
    const css = withToken(shippedStylesheet(), '--dsw-alias-state-business-primary', 'var(--dsw-static-greeneek-500)')
    const violations = contrastViolations(lightThemeColors(css))
    expect(violations[0]?.check.role).toBe('--dsw-alias-state-business-primary')
  })

  it('fails loud when a paired token stops existing', () => {
    const css = shippedStylesheet().replace(/^(\s*--dsw-alias-label-caption:)[^;]+;/m, '')
    expect(() => contrastViolations(lightThemeColors(css))).toThrow('token --dsw-alias-label-caption is not declared')
  })

  it('fails loud when a surface pair carries alpha without naming its backdrop', () => {
    const alphaSurface = check('--dsw-alias-label-primary', '--dsw-alias-bg-mask-1')
    expect(() => contrastViolations(lightThemeColors(shippedStylesheet()), [alphaSurface]))
      .toThrow('surface --dsw-alias-bg-mask-1 carries alpha and names no surface beneath it')
  })

  it('composites an accent wash against the solid rung named beneath it', () => {
    const colors = lightThemeColors(shippedStylesheet())
    const wash = { token: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-base' }
    // The backdrop is load-bearing: the same wash over the lightest rung
    // measures differently, and a wash that names no backdrop cannot be read.
    expect(surfaceColor(colors, wash)).not.toEqual({ red: 50, green: 131, blue: 82 })
    expect(surfaceColor(colors, { token: wash.token, over: '--dsw-alias-bg-overlay' }))
      .not.toEqual(surfaceColor(colors, wash))
    expect(() => surfaceColor(colors, { token: wash.token })).toThrow()
    expect(contrastRatio(solid(colors, '--dsw-alias-label-tertiary'), surfaceColor(colors, wash))).toBeGreaterThan(4.5)
  })

  it('keeps the mandated role, state, and surface coverage in the table', () => {
    const roles = new Set(LIGHT_CONTRAST_CHECKS.map(subject => subject.foreground))
    for (const token of [
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-caption',
      '--dsw-alias-label-dimmed',
      '--dsw-alias-label-primary-inverted',
      '--dsw-alias-label-primary-foreground',
      '--dsw-alias-state-business-primary',
      '--dsw-alias-button-ghost-active-border',
      '--dsw-alias-scrollbar-bg-l1',
      '--dsw-alias-scrollbar-bg-l2',
      '--dsw-alias-brand-primary',
    ]) {
      expect(roles.has(token), `${token} left the contrast table`).toBe(true)
    }
    expect(new Set(LIGHT_CONTRAST_CHECKS.map(subject => subject.state)))
      .toEqual(new Set(['default', 'hover', 'selected', 'focus', 'placeholder', 'disabled']))
    for (const subject of LIGHT_CONTRAST_CHECKS) {
      for (const surface of subject.surfaces) expect(surface.token).not.toBe(subject.foreground)
    }
    const states = LIGHT_CONTRAST_CHECKS.map(subject => subject.state)
    for (const state of ['hover', 'selected', 'focus', 'placeholder', 'disabled']) {
      expect(states, `no ${state} pairing remains`).toContain(state)
    }
  })

  it('pairs each neutral label role with the four approved light rungs', () => {
    const rungs = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-overlay',
    ]
    const flatRoles = [
      '--dsw-alias-label-primary',
      '--dsw-alias-label-primary-dimmed',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-label-caption',
      '--dsw-alias-label-dimmed',
      '--dsw-alias-label-primary-bluish',
      '--dsw-alias-state-business-primary',
    ]
    const neutral = LIGHT_CONTRAST_CHECKS.filter(subject => flatRoles.includes(subject.foreground))
    // `-dimmed` carries both the placeholder and the disabled role, so the
    // pairing count is one above the role count; no other role may drop out.
    expect(new Set(neutral.map(subject => subject.foreground))).toEqual(new Set(flatRoles))
    for (const subject of neutral) {
      const surfaces = subject.surfaces.map(surface => surface.token)
      for (const rung of rungs) expect(surfaces, `${subject.role} [${subject.state}] skips ${rung}`).toContain(rung)
    }
    // The two accent carriers and the scroll thumb read against their own fills,
    // never a flat rung, so a lightening of the brand or thumb token is caught.
    for (const subject of LIGHT_CONTRAST_CHECKS.filter(item =>
      item.foreground === '--dsw-alias-label-primary-foreground'
      || item.foreground === '--dsw-alias-label-primary-inverted')) {
      expect(subject.surfaces.length).toBeGreaterThanOrEqual(3)
    }
  })
})
