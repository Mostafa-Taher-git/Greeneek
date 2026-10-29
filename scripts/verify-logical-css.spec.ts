/** Directional-physical-CSS rejection in client stylesheets. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { logicalCssViolations, type PhysicalAllowance } from './verify-logical-css.ts'

describe('logical CSS', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gnk-logical-css-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(path: string, content: string): void {
    const target = resolve(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  function css(content: string): string[] {
    write('packages/client/ui-example/src/client/Example.module.css', content)
    return logicalCssViolations(root, new Map())
  }

  it('accepts the repository client stylesheet inventory', () => {
    expect(logicalCssViolations(resolve(import.meta.dirname, '..'))).toEqual([])
  })

  it('rejects an empty client CSS corpus', () => {
    expect(() => logicalCssViolations(root)).toThrow('the client CSS corpus is empty')
  })

  it.each([
    ['margin-left', 'margin-inline-start'],
    ['margin-right', 'margin-inline-end'],
    ['padding-left', 'padding-inline-start'],
    ['padding-right', 'padding-inline-end'],
    ['border-left', 'border-inline-start'],
    ['border-right', 'border-inline-end'],
    ['border-left-color', 'border-inline-start-color'],
    ['border-right-width', 'border-inline-end-width'],
  ])('rejects %s with its logical successor named', (property, successor) => {
    expect(css(`.a { ${property}: 1px; }\n`)).toEqual([
      `packages/client/ui-example/src/client/Example.module.css:1: ${property}: rename to the logical ${successor} property`,
    ])
  })

  it('rejects text alignment to a physical side', () => {
    expect(css('.a { text-align: left; }\n.b { text-align: right !important; }\n')).toEqual([
      'packages/client/ui-example/src/client/Example.module.css:1: text-align: left: use start or end',
      'packages/client/ui-example/src/client/Example.module.css:2: text-align: right !important: use start or end',
    ])
  })

  it('admits logical alignment and logical inset properties', () => {
    expect(css('.a { text-align: start; text-align: end; inset-inline-start: 0; inset-inline-end: 4px; inset-block: 0; }\n')).toEqual([])
  })

  it.each([
    ['margin: 4px 0 4px 4px;'],
    ['padding: 0 4px 0 8px;'],
    ['inset: 4px 8px auto 16px;'],
    ['padding: 10px 16px 12px calc(var(--x) + var(--y, 0px));'],
  ])('rejects the asymmetric four-value shorthand %s', (declaration) => {
    const violations = css(`.a { ${declaration} }\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(': horizontal values differ; write block/inline longhands')
  })

  it('admits symmetric and short shorthands whose horizontal values match', () => {
    expect(css([
      '.a { margin: 4px 8px 4px 8px; }',
      '.b { padding: 12px 14px 12px 14px; }',
      '.c { inset: 0; }',
      '.d { margin: 4px 0 0; }',
      '.e { padding: 12px 16px; }',
    ].join('\n') + '\n')).toEqual([])
  })

  it('rejects a physical inline offset outside an override', () => {
    expect(css('.a { left: 0; }\n.b .c { right: 8px; }\n')).toEqual([
      'packages/client/ui-example/src/client/Example.module.css:1: .a: left: use inset-inline-start, or record this declaration in the gate allowlist',
      'packages/client/ui-example/src/client/Example.module.css:2: .b .c: right: use inset-inline-end, or record this declaration in the gate allowlist',
    ])
  })

  it('finds a client stylesheet outside the client package group', () => {
    write('packages/extensions/ui-example/src/client/Example.module.css', '.a { padding-left: 4px; }\n')
    expect(logicalCssViolations(root, new Map())).toEqual([
      'packages/extensions/ui-example/src/client/Example.module.css:1: padding-left: rename to the logical padding-inline-start property',
    ])
  })

  it('admits a physical offset inside a dir=rtl override', () => {
    expect(css("[dir='rtl'] .a { transform: translateX(2px); left: auto; right: 0; }\n@media (min-width: 40rem) {\n  [dir='rtl'] .b { right: 4px; }\n}\n")).toEqual([])
  })

  it('admits a physical text alignment inside a dir=rtl override', () => {
    expect(css("[dir='rtl'] .message { text-align: right; }\n")).toEqual([])
  })

  it('admits only the recorded declarations of an allowlisted file', () => {
    const path = 'packages/client/ui-allowlisted/src/client/Kept.module.css'
    const allowlist: ReadonlyMap<string, PhysicalAllowance> = new Map([[
      path,
      {
        reason: 'centering fallback animates its physical offsets',
        declarations: [
          { selector: '.a', property: 'left' },
          { selector: '.a', property: 'right' },
          { selector: '.a', property: 'transition' },
        ],
      },
    ]])
    write(path, '.a { left: 50%; right: 4px; transition: left 140ms ease-out; }\n.b { left: 8px; }\n')
    write('packages/client/ui-allowlisted/src/client/Kept-other.module.css', '.a { padding-left: 4px; }\n')
    expect(logicalCssViolations(root, allowlist)).toEqual([
      'packages/client/ui-allowlisted/src/client/Kept-other.module.css:1: padding-left: rename to the logical padding-inline-start property',
      'packages/client/ui-allowlisted/src/client/Kept.module.css:2: .b: left: use inset-inline-start, or record this declaration in the gate allowlist',
    ])
  })

  it.each([
    ['packages/client/ui-stale/src/client/Gone.module.css', { selector: '.a', property: 'right' }],
    ['packages/client/ui-example/src/client/Example.module.css', { selector: '.b', property: 'left' }],
  ] as const)('rejects the stale allowlist entry %s %o', (path, admission) => {
    const allowlist: ReadonlyMap<string, PhysicalAllowance> = new Map([[path, {
      reason: 'removed with the rule',
      declarations: [admission],
    }]])
    write('packages/client/ui-example/src/client/Example.module.css', '.a { margin: 0; }\n')
    expect(() => logicalCssViolations(root, allowlist)).toThrow('matched no physical declaration')
  })

  it('rejects an allowlist entry with no recorded reason', () => {
    const path = 'packages/client/ui-example/src/client/Example.module.css'
    const allowlist: ReadonlyMap<string, PhysicalAllowance> = new Map([[path, {
      reason: ' ',
      declarations: [{ selector: '.a', property: 'left' }],
    }]])
    write(path, '.a { left: 50%; }\n')
    expect(() => logicalCssViolations(root, allowlist)).toThrow('has no reason')
  })

  it('rejects an allowlist entry that admits no declaration', () => {
    const path = 'packages/client/ui-example/src/client/Example.module.css'
    const allowlist: ReadonlyMap<string, PhysicalAllowance> = new Map([[path, {
      reason: 'empty after a rule removed its offset',
      declarations: [],
    }]])
    write(path, '.a { margin: 0; }\n')
    expect(() => logicalCssViolations(root, allowlist)).toThrow('admits no declaration')
  })

  it.each([
    ['transition: left 140ms ease-out;'],
    ['transition-property: margin-right, opacity;'],
    ['transition: transform 100ms, padding-left 180ms var(--e);'],
  ])('rejects a transition list that names a renamed property: %s', (declaration) => {
    const violations = css(`.a { ${declaration} }\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(': name the logical property')
  })

  it('admits a transition list naming logical properties', () => {
    expect(css('.a { transition: margin-inline-end 150ms var(--e); transition-property: inset-inline-start, width; }\n')).toEqual([])
  })

  it('flags a physical offset inside keyframes, whose prelude carries no override', () => {
    expect(css('@keyframes slide {\n  from { left: -300px; }\n  to { inset-inline-start: 100%; }\n}\n')).toEqual([
      'packages/client/ui-example/src/client/Example.module.css:2: from: left: use inset-inline-start, or record this declaration in the gate allowlist',
    ])
  })

  it('attributes a multiline declaration to its first line and ignores commented-out declarations', () => {
    expect(css('/* .z { left: 4px; } */\n.a {\n  left: clamp(\n    0px,\n    100%,\n    420px\n  );\n}\n')).toEqual([
      'packages/client/ui-example/src/client/Example.module.css:3: .a: left: use inset-inline-start, or record this declaration in the gate allowlist',
    ])
  })

  it('rejects a physical offset under an at-rule prelude the chain keeps out of the override check', () => {
    expect(css('@media (max-width: 760px) {\n  .a { right: 0; }\n}\n')).toEqual([
      'packages/client/ui-example/src/client/Example.module.css:2: .a: right: use inset-inline-end, or record this declaration in the gate allowlist',
    ])
  })
})
