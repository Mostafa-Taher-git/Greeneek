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
    expect(root?.get('padding')).toBe('10px var(--gnk-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--gnk-sidebar-inline-padding) + var(--gnk-sidebar-glass-inset))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('suspends the shell as one flat Edge Frame surface', () => {
    // The material is one decorative layer: solid base token, no veil, mist,
    // or blur. Expanded, it is flush to the column (inset collapses to 0,
    // radius to 0) and closed by a single 1px right seam; collapsed, it
    // floats as a bordered compact rail card. The panel is drawn by ::before
    // at negative z inside .root's own stacking context, so no child layout
    // moves for it, and every edge is box-shadow — never a border-token
    // border.
    const root = declarations('.root')
    expect(root?.get('background')).toBe('transparent')
    expect(root?.get('--gnk-sidebar-glass-inset')).toBe('8px')
    expect(root?.get('isolation')).toBe('isolate')
    // The explicit level keeps the settings dialog — a fixed descendant of
    // this context — above the conversation column's z-index:0 subtree.
    expect(root?.get('z-index')).toBe('30')
    const flush = declarations('.root:not(.collapsed)')
    expect(flush?.get('--gnk-sidebar-glass-inset')).toBe('0px')
    expect(flush?.get('--gnk-sidebar-radius')).toBe('0px')
    const panel = declarations('.root::before')
    expect(panel?.get('inset')).toBe('var(--gnk-sidebar-glass-inset)')
    expect(panel?.get('border-radius')).toBe('var(--gnk-sidebar-radius)')
    expect(panel?.get('z-index'), panel?.get('z-index')).toBe('-1')
    expect(panel?.get('background')).toBe('var(--dsw-alias-bg-base)')
    expect(panel?.get('backdrop-filter')).toBeUndefined()
    expect(panel?.get('box-shadow'), 'rail card ring').toBe('0 0 0 1px var(--dsw-alias-border-l1)')
    expect(declarations('.root:not(.collapsed)::before')?.get('box-shadow')).toBe(
      'inset -1px 0 0 var(--dsw-alias-border-l1)',
    )
    expect(declarations('.root.collapsed')?.get('padding')).toBe('14px 10px')
  })

  it('melts the panel geometry and the region margin on the fade clock', () => {
    // The inset var flip between the rail card and the flush column is
    // instant; what the eye gets is the 150ms melt on the painted edges and
    // on the region's trailing margin, so the variant never steps.
    const panel = declarations('.root::before')
    expect(panel?.get('transition')).toBe(
      'inset 150ms var(--ds-ease-in-out), border-radius 150ms var(--ds-ease-in-out), box-shadow 150ms var(--ds-ease-in-out)',
    )
    expect(declarations('.regionArea')?.get('transition')).toBe('margin-right 150ms var(--ds-ease-in-out)')
  })

  it('stages the rail controls top-to-bottom while the settings seat only fades', () => {
    // The V2 entrance is a choreography, not one shared animation: each seat
    // gets its own delay so the rail fills in toggle → New Session → region
    // → brand mark (its new bottom seat, dropping into place beside the
    // fading foot). Pin the pairs, including the overshoot curve.
    const stagger: Array<[selector: string, animation: string]> = [
      ['.railIn .newSession', 'rail-in 200ms var(--gnk-sidebar-neon-ease) 0ms backwards'],
      ['.railIn .regionArea', 'rail-in 200ms var(--gnk-sidebar-neon-ease) 60ms backwards'],
      ['.railIn .logoRow', 'logo-rail-in 200ms var(--gnk-sidebar-neon-ease) 120ms backwards'],
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
