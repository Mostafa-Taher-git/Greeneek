import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The generated-artifact freshness gate must cover exactly the catalogs whose
 * drift poisons unrelated PRs. A generator removed from the gate without a
 * replacement contract fails here, before its artifact can go stale on main.
 */

const root = resolve(import.meta.dirname, '..')

describe('verify-generated-artifacts', () => {
  const source = readFileSync(resolve(root, 'scripts/verify-generated-artifacts.ts'), 'utf8')

  /** Every generator the freshness contract names, with its artifact homes. */
  const REQUIRED = [
    { script: 'scripts/gen-cordis-catalog.ts', artifact: 'docs/cordis-api' },
    { script: 'scripts/gen-tool-catalog.ts', artifact: 'docs/tool-catalog.md' },
    { script: 'scripts/gen-plugin-catalog.ts', artifact: 'docs/plugin-catalog.md' },
    { script: 'scripts/gen-config-catalog.ts', artifact: 'docs/config-catalog.md' },
    { script: 'scripts/gen-persistence-catalog.ts', artifact: 'docs/persistence-catalog.md' },
    { script: 'scripts/gen-client-catalog.ts', artifact: 'slot-catalog.ts' },
  ] as const

  it('covers every catalog the freshness contract names', () => {
    for (const required of REQUIRED) {
      expect(source, `${required.script} must be gated`).toContain(`'${required.script}'`)
      expect(source, `${required.script} must name its artifact paths`).toContain(required.artifact)
    }
  })

  it('names the regeneration command and staging paths on drift', () => {
    expect(source).toContain('pnpm run ${check.regenerate}')
    expect(source).toContain('git add')
  })

  it('never regenerates from the gate', () => {
    // Auto-regeneration races concurrent hook jobs; the gate only verifies.
    expect(source).toContain("'--check'")
    expect(source).not.toMatch(/\bwriteFileSync\b/)
  })

  it('is wired into pre-push and CI beside the byte-equality checks', () => {
    const lefthook = readFileSync(resolve(root, 'lefthook.yml'), 'utf8')
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
    expect(lefthook).toContain('pnpm run verify-generated-artifacts')
    expect(ci).toContain('pnpm run verify-generated-artifacts')
    expect(readFileSync(resolve(root, 'package.json'), 'utf8')).toContain('"verify-generated-artifacts": "tsx scripts/verify-generated-artifacts.ts"')
  })
})
