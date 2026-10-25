import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditSourcePlane } from './verify-source-plane.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build a throwaway repository root from repository-relative paths. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-source-plane-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return root
}

describe('source-plane audit', () => {
  it('accepts authored source, including an ambient declaration with no TypeScript sibling', () => {
    const audit = auditSourcePlane(tree({
      'packages/core/session/src/index.ts': 'export {}\n',
      'packages/client/ui-chat/src/css-modules.d.ts': "declare module '*.css'\n",
    }))

    expect(audit.roots).toBe(2)
    expect(audit.files).toBe(2)
    expect(audit.violations).toEqual([])
  })

  it('rejects a declaration emitted beside the source it was generated from', () => {
    const audit = auditSourcePlane(tree({
      'packages/api/authorization-controller/src/types.ts': 'export interface A {}\n',
      'packages/api/authorization-controller/src/types.d.ts': 'export interface A {}\n',
    }))

    expect(audit.violations).toEqual([
      { path: 'packages/api/authorization-controller/src/types.d.ts', rule: 'declaration' },
    ])
  })

  it('rejects runtime output and source maps and sorts every violation by path', () => {
    const audit = auditSourcePlane(tree({
      'packages/api/authorization-controller/src/types.ts': 'export interface A {}\n',
      'packages/api/authorization-controller/src/types.js': 'export {}\n',
      'packages/api/authorization-controller/src/types.js.map': '{}\n',
      'packages/api/authorization-controller/src/types.d.ts.map': '{}\n',
      'packages/core/session/src/index.mjs': 'export {}\n',
    }))

    expect(audit.violations).toEqual([
      { path: 'packages/api/authorization-controller/src/types.d.ts.map', rule: 'map' },
      { path: 'packages/api/authorization-controller/src/types.js', rule: 'runtime' },
      { path: 'packages/api/authorization-controller/src/types.js.map', rule: 'map' },
      { path: 'packages/core/session/src/index.mjs', rule: 'runtime' },
    ])
  })

  it('scans the real tree without emitted output', () => {
    const audit = auditSourcePlane()

    expect(audit.violations).toEqual([])
    expect(audit.files).toBeGreaterThan(0)
  })
})
