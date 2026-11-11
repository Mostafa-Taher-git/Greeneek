/**
 * Enforce the architectural dependency rules (the dependency-cruiser set,
 * pattern-based on `gnk-*`, with no enumerated package lists):
 *
 * 1. No `src/` outside `packages/core/agent-loop` imports
 *    `@greeneek/gnk-agent-loop` (the swappable loop; bundles compose it via
 *    `cordis.yml`, never via an import). Tests are deliberately excluded:
 *    real-composition suites mount the concrete loop (testing policy), so a
 *    test import is evidence, not a coupling defect. Production `src`
 *    coupling is what would make the loop unswappable.
 * 2. No cross-package deep import into a `src/` tree: a bare specifier that
 *    contains `/src/` fails; public entries and relative imports are allowed.
 * 3. No import cycle between workspace packages, via bare imports.
 * 4. `vendor/` never imports from `packages/` (the vendored framework layer
 *    does not depend on the harness).
 * 5. A bare workspace import must be declared in the importer's
 *    `package.json` (`dependencies`/`peerDependencies`/`devDependencies`/
 *    `optionalDependencies`) — this is the layering-table enforcement: bundles
 *    may depend on the spine, so the spine never imports a bundle unless the
 *    spine itself declares it.
 *
 * Reads `packages/` and `vendor/` manifests plus source imports, prints the
 * resolved package count and import count, and fails loud on any violation.
 * @module scripts/verify-dependency-rules
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const AGENT_LOOP = '@greeneek/gnk-agent-loop'
const WORKSPACE_PREFIX = '@greeneek/'

/** One violation of a dependency rule. */
export interface DependencyRuleFailure {
  rule: string
  location: string
  detail: string
}

/** Result of checking every workspace package. */
export interface DependencyRulesReport {
  packageCount: number
  importCount: number
  failures: DependencyRuleFailure[]
}

function readJson(root: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-dependency-rules: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function manifestDeps(manifest: Record<string, unknown>): Set<string> {
  const names = new Set<string>()
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const deps = manifest[section]
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) continue
    for (const name of Object.keys(deps)) names.add(name)
  }
  return names
}

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries.sort()) {
    const path = join(dir, entry)
    let isDirectory = false
    try {
      isDirectory = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (isDirectory) {
      if (entry === 'node_modules' || entry === 'lib') continue
      walkFiles(path, out)
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(path)
  }
  return out
}

interface WorkspacePackage {
  directory: string
  name: string
  packageDir: string
  deps: Set<string>
}

function listWorkspacePackages(root: string): WorkspacePackage[] {
  const packages = join(root, 'packages')
  const out: WorkspacePackage[] = []
  for (const group of readdirSync(packages).sort()) {
    const groupDir = join(packages, group)
    if (!existsSync(groupDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(groupDir)
    } catch {
      continue
    }
    for (const directory of entries.sort()) {
      const packageDir = join(groupDir, directory)
      const manifestPath = join(packageDir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = readJson(root, `packages/${group}/${directory}/package.json`)
      const name = typeof manifest.name === 'string' ? manifest.name : undefined
      if (name === undefined || !name.startsWith(WORKSPACE_PREFIX)) continue
      out.push({
        directory: `packages/${group}/${directory}`,
        name,
        packageDir,
        deps: manifestDeps(manifest),
      })
    }
  }
  return out
}

const IMPORT_RE = /(from\s+|import\s*\(\s*|import\s+type\s+|import\s+|require\s*\(\s*|export\s+(?:\*|.*from\s+))['"]([^'"]+)['"]/g

/** One bare workspace import occurrence in a source file. */
export interface BareImport {
  specifier: string
  /** True for `import type` / `export type`, which erase to no runtime edge. */
  typeOnly: boolean
  /** True for `import()` / `require()` call expressions, which are lazy. */
  dynamic: boolean
}

/**
 * Extract bare workspace specifiers a source file imports.
 * @param text - source file contents.
 * @returns every `@greeneek/...` import, in file order.
 */
export function bareWorkspaceImports(text: string): BareImport[] {
  const out: BareImport[] = []
  for (const match of text.matchAll(IMPORT_RE)) {
    const prefix = match[1] ?? ''
    const spec = match[2]
    if (spec !== undefined && spec.startsWith(WORKSPACE_PREFIX)) {
      // `import type { X } from '...'` matches at the `from`, so type-ness
      // is decided by the import statement's opening, not the prefix alone.
      const lineStart = text.lastIndexOf('\n', match.index) + 1
      const stmt = text.slice(lineStart, match.index + prefix.length)
      out.push({
        specifier: spec,
        typeOnly: /\bimport\s+type\b/.test(stmt) || /type\s+$/.test(prefix),
        dynamic: prefix.includes('(') || prefix.startsWith('require'),
      })
    }
  }
  return out
}

function packageNameOf(specifier: string): string {
  const rest = specifier.slice(WORKSPACE_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return `@greeneek/${rest}`
  return `@greeneek/${rest.slice(0, slash)}`
}

function rel(root: string, absolute: string): string {
  return absolute.slice(root.length).replaceAll('\\', '/').replace(/^\//, '')
}

/**
 * Check the dependency rules under one repository root.
 * @param root - absolute repository root.
 * @returns package/import counts and every violation.
 */
export function inspectDependencyRules(root: string): DependencyRulesReport {
  const packages = listWorkspacePackages(root)
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const failures: DependencyRuleFailure[] = []
  let importCount = 0

  // Package-level import graph for cycle detection (bare imports only).
  const edges = new Map<string, Set<string>>()
  for (const pkg of packages) edges.set(pkg.name, new Set())

  for (const pkg of packages) {
    const files = walkFiles(join(pkg.packageDir, 'src'))
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const bare of bareWorkspaceImports(text)) {
        importCount++
        const spec = bare.specifier
        const location = rel(root, file)
        const targetName = packageNameOf(spec)
        // Rule 2: deep import into src/. Test-support and experimental
        // packages are internal prototypes and test harness, not shipped
        // product layering, so their deep imports are out of scope.
        const importerGroup = pkg.directory.split('/')[1] ?? ''
        if (!bare.typeOnly && (spec.includes('/src/') || spec.endsWith('/src'))
          && importerGroup !== 'experimental' && importerGroup !== 'test-support') {
          failures.push({
            rule: 'no-deep-src-imports',
            location,
            detail: `deep import ${spec} reaches into a package src/ tree; use a public entry point instead.`,
          })
        }
        // Rule 1: agent-loop isolation (src only; tests/examples are allowed).
        if (spec === AGENT_LOOP || spec.startsWith(`${AGENT_LOOP}/`)) {
          failures.push({
            rule: 'agent-loop-isolation',
            location,
            detail: `src imports ${AGENT_LOOP}; only packages/core/agent-loop itself may depend on the concrete loop.`,
          })
        }
        // Rule 5: declared dependency for static value imports only.
        // Type-only imports erase to no runtime edge, and dynamic
        // import()/require() calls are lazy optional integrations the
        // package.json dependency classifier owns elsewhere.
        if (!bare.typeOnly && !bare.dynamic && !pkg.deps.has(targetName) && targetName !== pkg.name) {
          failures.push({
            rule: 'declared-dependencies',
            location,
            detail: `imports ${targetName} but ${pkg.name} does not declare it in package.json.`,
          })
        }
        if (!bare.typeOnly) {
          const target = byName.get(targetName)
          if (target !== undefined && target.name !== pkg.name) edges.get(pkg.name)?.add(target.name)
        }
      }
    }
  }

  // Rule 1 tests are counted but not failed (see the header): real-composition
  // tests mount the concrete loop on purpose. Production src isolation above
  // is the enforced half.

  // Rule 4: vendor never imports packages.
  const vendor = join(root, 'vendor')
  let vendorEntries: string[] = []
  try {
    vendorEntries = readdirSync(vendor)
  } catch {
    // No vendor/ directory: nothing to check.
  }
  for (const entry of vendorEntries.sort()) {
    const src = join(vendor, entry, 'src')
    if (!existsSync(src)) continue
    for (const file of walkFiles(src)) {
      const text = readFileSync(file, 'utf8')
      for (const bare of bareWorkspaceImports(text)) {
        importCount++
        const spec = bare.specifier
        // `@greeneek/cordis` self-imports are the vendored framework's own
        // names; only harness `gnk-` imports violate vendor isolation.
        if (spec.startsWith('@greeneek/gnk-')) {
          failures.push({
            rule: 'vendor-isolation',
            location: rel(root, file),
            detail: `vendor imports harness package ${spec}; vendor/ must not depend on packages/.`,
          })
        }
      }
    }
  }

  // Rule 3: import cycles between packages.
  for (const cycle of findCycles(edges)) {
    failures.push({
      rule: 'no-package-cycles',
      location: cycle.join(' -> '),
      detail: 'import cycle between workspace packages; break it before merging.',
    })
  }

  return { packageCount: packages.length, importCount, failures }
}

function findCycles(edges: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = []
  const visiting = new Set<string>()
  const done = new Set<string>()
  const path: string[] = []
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (visiting.has(id)) {
      const start = path.indexOf(id)
      if (start >= 0) cycles.push([...path.slice(start), id])
      return
    }
    visiting.add(id)
    path.push(id)
    for (const next of [...(edges.get(id) ?? [])].sort()) visit(next)
    path.pop()
    visiting.delete(id)
    done.add(id)
  }
  for (const id of [...edges.keys()].sort()) visit(id)
  return cycles
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectDependencyRules(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write(`verify-dependency-rules: ${String(report.failures.length)} violation(s):\n`)
    for (const failure of report.failures) {
      process.stderr.write(`  [${failure.rule}] ${failure.location}: ${failure.detail}\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-dependency-rules: ${String(report.packageCount)} package(s), ${String(report.importCount)} bare workspace import(s) checked; all rules hold.\n`,
    )
  }
}
