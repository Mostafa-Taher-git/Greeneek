/**
 * Coverage for the retired pair-record hook (`maybeRecordPair`) and the
 * region helpers. Pair records are retired: regeneration never writes
 * `.i18n.yaml` sidecars, and generated regions render identically everywhere.
 */

import { describe, expect, it } from 'vitest'
import {
  localizePageRegion,
  maybeRecordPair,
  REGION_BEGIN,
  REGION_END,
  spliceRegion,
} from './gen-cordis-catalog.ts'

describe('maybeRecordPair', () => {
  it('is retired: regeneration never writes pair records', () => {
    expect(maybeRecordPair('docs/subsystems/fix.md', new Map(), '/nonexistent-root')).toBe(false)
  })
})

describe('spliceRegion', () => {
  it('replaces exactly the cordis-surface region', () => {
    const doc = `# T\n\nprose\n\n${REGION_BEGIN}\nold\n${REGION_END}\ntail\n`
    expect(spliceRegion(doc, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toBe(`# T\n\nprose\n\n${REGION_BEGIN}\nnew\n${REGION_END}\ntail\n`)
  })

  it('fails loud on a page carrying only some other generator\'s region', () => {
    // Another generator's markers satisfy the generic region grammar but must
    // never be overwritten by THIS generator's splice.
    const foreign = '# T\n\n<!-- BEGIN GENERATED other-surface (other-gen.ts) — do not edit between markers -->\ntheirs\n<!-- END GENERATED other-surface -->\n'
    expect(() => spliceRegion(foreign, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toThrow('expected exactly 1 cordis-surface region, found 0 BEGIN/0 END')
  })

  it('fails loud on duplicate cordis-surface markers', () => {
    const doubled = `${REGION_BEGIN}\na\n${REGION_END}\n${REGION_BEGIN}\nb\n${REGION_END}\n`
    expect(() => spliceRegion(doubled, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toThrow('found 2 BEGIN/2 END')
  })
})

describe('localizePageRegion', () => {
  it('returns the region unchanged: generated reference is English-only', () => {
    const region = `${REGION_BEGIN}
[Target](target.md#api)
${REGION_END}`
    expect(localizePageRegion(region)).toBe(region)
  })
})
