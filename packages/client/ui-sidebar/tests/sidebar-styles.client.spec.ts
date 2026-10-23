/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--gnk-sidebar-inline-padding')).toBe('12px')
    expect(root?.get('padding')).toBe('6px var(--gnk-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--gnk-sidebar-inline-padding))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('stages the rail controls top-to-bottom while the settings seat only fades', () => {
    // The V2 entrance is a choreography, not one shared animation: each seat
    // gets its own delay so the rail fills in mark → toggle → New Session →
    // region → foot. Pin the pairs, including the overshoot curve.
    const stagger: Array<[selector: string, animation: string]> = [
      ['.railIn .logoRow', 'logo-rail-in 200ms var(--gnk-sidebar-neon-ease) 0ms backwards'],
      ['.railIn .toggleRail', 'toggle-rail-in 200ms var(--gnk-sidebar-neon-ease) 30ms backwards'],
      ['.railIn .newSession', 'rail-in 200ms var(--gnk-sidebar-neon-ease) 60ms backwards'],
      ['.railIn .regionArea', 'rail-in 200ms var(--gnk-sidebar-neon-ease) 90ms backwards'],
      ['.railIn .footArea', 'rail-fade-in 200ms var(--gnk-sidebar-neon-ease) 120ms backwards'],
    ]
    for (const [selector, animation] of stagger) {
      expect(declarations(selector)?.get('animation'), selector).toBe(animation)
    }
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('replays the expand choreography only through the one-shot class', () => {
    // The class (SidebarRoot.tsx) is what gates the expand entrance and its
    // sheen; a cold expanded paint must not animate the arrival.
    for (const selector of [
      '.expanding .logoRow',
      '.expanding .newSession',
      '.expanding .regionArea',
      '.expanding .footArea',
    ]) {
      expect(declarations(selector)?.get('animation'), selector)
        .toMatch(/^neon-expand-in 200ms var\(--gnk-sidebar-neon-ease\) \d+ms backwards$/)
    }
    expect(declarations('.expanding .newSession::before')?.get('animation'))
      .toBe('neon-sweep 480ms var(--ds-ease-in-out) 60ms both')
  })

  it('gives shell rail controls the same base anchor for their shared translation', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('center')
    expect(declarations('.collapsed .newSession')?.get('align-self')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('width')).toBe('36px')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('24px')
    expect(declarations('.brandName')?.get('font-size')).toBe('18px')
    expect(declarations('.fallbackBrandName')?.get('font-size')).toBe('17px')
    expect(declarations('.fallbackBrandName')?.get('white-space')).toBe('nowrap')
  })
})
