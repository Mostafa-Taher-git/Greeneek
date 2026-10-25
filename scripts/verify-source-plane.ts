/**
 * Reject emitted build output inside a workspace package's `src/`.
 *
 * The source plane is what every static gate, test, and tsconfig `paths` entry
 * reads; a compiler run that drops a declaration beside its own source turns
 * that output into apparent source for every later check. The concrete failure
 * is not hypothetical: a stray `src/types.js` plus `src/types.d.ts` beside
 * `src/types.ts` arrives in `pnpm run lint` as roughly a hundred stylistic
 * errors that have nothing to do with the change being reviewed.
 *
 * The rules stay narrow so hand-written ambient declarations keep working. A
 * `.d.ts` is only a violation when a sibling `.ts` of the same stem exists — the
 * signature of an emitted declaration — so `css-modules.d.ts` and other
 * authored declaration files pass. Runtime `.js`, `.mjs`, `.cjs`, and any
 * `.map` inside `src/` are always emitted: this repository keeps its source in
 * TypeScript and its build output under `lib/`.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** One file rejected in the source plane, with the rule it broke. */
export interface SourcePlaneViolation {
  /** Repository-relative path of the offending file. */
  readonly path: string
  /** Which emitted-artifact rule it broke. */
  readonly rule: 'runtime' | 'map' | 'declaration'
}

/** Result of scanning the source plane of every workspace package. */
export interface SourcePlaneAudit {
  /** Package `src/` roots that were scanned. */
  readonly roots: number
  /** Files accepted as authored source. */
  readonly files: number
  /** Every rejected file, sorted by path. */
  readonly violations: readonly SourcePlaneViolation[]
}

/** Runtime output never belongs in `src/`. */
const RUNTIME_SUFFIXES = ['.js', '.mjs', '.cjs'] as const
/** Source maps never belong in `src/`. */
const MAP_SUFFIXES = ['.js.map', '.d.ts.map'] as const

/**
 * Audit every `packages/<group>/<package>/src` tree under the repository root.
 * @param scanRoot - repository root containing `packages/`.
 * @returns the scanned root and file counts plus every violation.
 */
export function auditSourcePlane(scanRoot: string = resolve(import.meta.dirname, '..')): SourcePlaneAudit {
  const groups = readdirSync(join(scanRoot, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
  const roots: string[] = []
  for (const group of groups) {
    const groupDir = join(scanRoot, 'packages', group.name)
    for (const pkg of readdirSync(groupDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const src = join(groupDir, pkg.name, 'src')
      if (existsSync(src)) roots.push(src)
    }
  }
  const violations: SourcePlaneViolation[] = []
  let files = 0
  for (const src of roots) {
    for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const absolute = join(entry.parentPath, entry.name)
      const relative = absolute.slice(scanRoot.length + 1).replaceAll('\\', '/')
      const suffix = MAP_SUFFIXES.find(candidate => entry.name.endsWith(candidate))
      if (suffix !== undefined) {
        violations.push({ path: relative, rule: 'map' })
        continue
      }
      if (RUNTIME_SUFFIXES.some(candidate => entry.name.endsWith(candidate))) {
        violations.push({ path: relative, rule: 'runtime' })
        continue
      }
      // An emitted declaration sits beside the source it was generated from;
      // an authored ambient declaration has no such sibling.
      if (entry.name.endsWith('.d.ts')) {
        const stem = entry.name.slice(0, -'.d.ts'.length)
        if (existsSync(join(entry.parentPath, `${stem}.ts`))) {
          violations.push({ path: relative, rule: 'declaration' })
          continue
        }
      }
      files += 1
    }
  }
  violations.sort((left, right) => left.path.localeCompare(right.path))
  return { roots: roots.length, files, violations }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const audit = auditSourcePlane()
  if (audit.violations.length > 0) {
    process.stderr.write(
      `verify-source-plane: ${String(audit.violations.length)} emitted file(s) inside a package src/\n`,
    )
    for (const violation of audit.violations) {
      process.stderr.write(`  ${violation.path} (${violation.rule})\n`)
    }
    process.stderr.write('Emit build output under lib/; see docs/development.md#typescript-project-layout.\n')
    process.exit(1)
  }
  process.stdout.write(
    `verify-source-plane: ${String(audit.files)} source file(s) across ${String(audit.roots)} package src/ tree(s), no emitted output.\n`,
  )
}
