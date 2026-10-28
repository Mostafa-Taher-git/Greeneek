// The inventory panel is fixed, so its measured anchor is the only thing
// keeping it against the trigger; the inline edge must follow the direction.

import { describe, expect, it } from 'vitest'
import { panelAnchor } from '../src/client/panel-anchor.ts'

const VIEWPORT = { width: 1200, height: 800 }

describe('the fixed inventory panel anchor', () => {
  it('hugs the trigger’s left edge under a left-to-right document', () => {
    expect(panelAnchor({ rect: { left: 100, right: 400, top: 700 }, viewport: VIEWPORT, rtl: false }))
      .toEqual({ insetInlineStart: 100, bottom: 108 })
  })

  it('mirrors to the trigger’s right edge under a right-to-left document', () => {
    expect(panelAnchor({ rect: { left: 900, right: 1100, top: 700 }, viewport: VIEWPORT, rtl: true }))
      .toEqual({ insetInlineStart: 100, bottom: 108 })
  })
})
