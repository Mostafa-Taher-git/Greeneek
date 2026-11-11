/**
 * Emit the aggregate configs' (`tsconfig.host.json`, `tsconfig.client.json`)
 * `references` from the `packages/<group>/<pkg>` hierarchy, instead of a
 * hand-maintained list. Adding a package then needs only its own `package.json`
 * and `tsconfig` files — this generator picks it up by the explicit face it
 * declares:
 *
 * - `packages/client/` is always the client aggregate (split packages name
 *   their `tsconfig.client.json` file).
 * - A package outside `client/` with a `tsconfig.host.json` (resp.
 *   `tsconfig.client.json`) contributes that face under its leaf config.
 * - Its non-solution `tsconfig.json` can contribute another face: extending
 *   `tsconfig.base.client.json` adds client, and extending `tsconfig.base.json`
 *   adds host. A solution-style `files: []` root contributes neither.
 * - `vendor/*`, `native/landlock-run/packages/entry`, and `apps/cli` are host;
 *   `apps/web` is client.
 *
 * Default mode rewrites the two committed configs' `references` blocks;
 * `--check` instead fails when they differ, so hygiene refuses a stale copy.
 * The resolved lists are printed, never silently skipped.
 *
 * @module scripts/gen-tsconfig-references
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, globSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const HOST_CONFIG = 'tsconfig.host.json'
const CLIENT_CONFIG = 'tsconfig.client.json'

type Face = 'host' | 'client'

interface PackageDir {
  group: string
  directory: string
  packageDir: string
}

/** Read a leaf tsconfig as text; JSONC comments are irrelevant to `extends` detection. */
function readTsconfig(packageDir: string, file: string): string {
  return readFileSync(join(packageDir, file), 'utf8')
}

/**
 * Which face a non-`client/` package declares in its leaf config.
 * @param packageDir - absolute package directory.
 * @param group - package group name.
 * @param directory - package directory name.
 * @returns host/client faces the package belongs to (empty for solution roots).
 */
export function facesFor(packageDir: string, group: string, directory: string): Face[] {
  if (group === 'client') return ['client']
  const hasHost = existsSync(join(packageDir, 'tsconfig.host.json'))
  const hasClient = existsSync(join(packageDir, 'tsconfig.client.json'))
  const faces: Face[] = []
  if (hasHost) faces.push('host')
  if (hasClient) faces.push('client')
  if (!existsSync(join(packageDir, 'tsconfig.json'))) return faces
  const text = readTsconfig(packageDir, 'tsconfig.json')
  // Solution roots select faces by indirection, never directly.
  if (/"files"\s*:\s*\[\s*\]/.test(text)) return faces
  if (text.includes('tsconfig.base.client.json') && !faces.includes('client')) faces.push('client')
  if (text.includes('tsconfig.base.json') && !faces.includes('host')) faces.push('host')
  if (faces.length > 0) return faces
  throw new Error(
    `gen-tsconfig-references: packages/${group}/${directory}/tsconfig.json extends neither tsconfig.base.json nor tsconfig.base.client.json; the face filter cannot classify it.`,
  )
}

/**
 * The `references` path a package contributes to one aggregate.
 * @param group - package group name.
 * @param directory - package directory name.
 * @param face - aggregate face.
 * @param packageDir - absolute package directory.
 * @returns repository-relative reference path for the face.
 */
export function referenceFor(group: string, directory: string, face: Face, packageDir: string): string {
  const base = `./packages/${group}/${directory}`
  if (face === 'host' && existsSync(join(packageDir, 'tsconfig.host.json'))) return `${base}/tsconfig.host.json`
  if (face === 'client' && existsSync(join(packageDir, 'tsconfig.client.json'))) return `${base}/tsconfig.client.json`
  return base
}

function listPackageDirs(root: string): PackageDir[] {
  const packages = join(root, 'packages')
  const out: PackageDir[] = []
  for (const group of readdirSync(packages).sort()) {
    const groupDir = join(packages, group)
    let entries: string[]
    try {
      entries = readdirSync(groupDir)
    } catch {
      continue
    }
    for (const directory of entries.sort()) {
      const packageDir = join(groupDir, directory)
      if (!existsSync(join(packageDir, 'package.json'))) continue
      if (!existsSync(join(packageDir, 'src')) && directory !== 'placeholder') {
        // Packages without a `src/` tree ship no build output; still require
        // a package.json to be present to be discovered.
        if (!existsSync(join(packageDir, 'package.json'))) continue
      }
      out.push({ group, directory, packageDir })
    }
  }
  return out
}

/**
 * Collect the host aggregate references, sorted by path.
 * @param root - absolute repository root.
 * @returns reference paths for `tsconfig.host.json`.
 */
export function collectHostReferences(root: string): string[] {
  const refs = new Set<string>()
  const vendor = join(root, 'vendor')
  for (const entry of readdirSync(vendor).sort()) {
    if (existsSync(join(vendor, entry, 'package.json'))) refs.add(`./vendor/${entry}`)
  }
  for (const { group, directory, packageDir } of listPackageDirs(root)) {
    if (facesFor(packageDir, group, directory).includes('host')) {
      refs.add(referenceFor(group, directory, 'host', packageDir))
    }
  }
  refs.add('./native/landlock-run/packages/entry')
  refs.add('./apps/cli')
  return [...refs].sort()
}

function readPackageName(packageDir: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof manifest.name === 'string' ? manifest.name : undefined
  } catch {
    return undefined
  }
}

function packageNameOf(specifier: string): string | undefined {
  if (!specifier.startsWith('@greeneek/')) return undefined
  const rest = specifier.slice('@greeneek/'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return `@greeneek/${rest}`
  return `@greeneek/${rest.slice(0, slash)}`
}

function clientIncludedFiles(root: string): string[] {
  let include: unknown
  try {
    const stripped = readFileSync(join(root, CLIENT_CONFIG), 'utf8')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n')
    include = (JSON.parse(stripped) as { include?: unknown }).include
  } catch {
    return []
  }
  if (!Array.isArray(include)) return []
  const files: string[] = []
  for (const pattern of include) {
    if (typeof pattern !== 'string') continue
    for (const file of globSync(pattern, { cwd: root })) {
      files.push(file.replaceAll('\\', '/'))
    }
  }
  return files
}

/**
 * Collect the client aggregate references, sorted by path.
 *
 * Client-face packages are the base. Packages imported *directly* by the
 * client aggregate's included files are added as well: client tests import
 * shared leaves directly (for example `@greeneek/gnk-typert-registry` from a
 * gateway client spec), and `tsc -b` requires every directly imported file
 * to be listed in the aggregate even when a leaf's `references` do not reach
 * it. Imports resolve to the target's client face when one exists, otherwise
 * its host-face directory (the cordis-free or identically-merged shared
 * leaves). The two specifiers' package identities in `package.json` are read
 * for the name-to-directory map; no hand-maintained list is kept.
 * @param root - absolute repository root.
 * @returns reference paths for `tsconfig.client.json`.
 */
export function collectClientReferences(root: string): string[] {
  const dirs = listPackageDirs(root)
  const byName = new Map<string, PackageDir>()
  for (const entry of dirs) {
    const name = readPackageName(entry.packageDir)
    if (name !== undefined) byName.set(name, entry)
  }
  const refs = new Set<string>()
  for (const entry of dirs) {
    if (facesFor(entry.packageDir, entry.group, entry.directory).includes('client')) {
      refs.add(referenceFor(entry.group, entry.directory, 'client', entry.packageDir))
    }
  }
  for (const file of clientIncludedFiles(root)) {
    let text: string
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](@greeneek\/[^'"]+)['"]/g)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      const name = packageNameOf(specifier)
      if (name === undefined) continue
      const target = byName.get(name)
      if (target === undefined) continue
      const faces = facesFor(target.packageDir, target.group, target.directory)
      if (faces.includes('client')) refs.add(referenceFor(target.group, target.directory, 'client', target.packageDir))
      else if (faces.includes('host')) refs.add(referenceFor(target.group, target.directory, 'host', target.packageDir))
    }
  }
  refs.add('./apps/web')
  return [...refs].sort()
}

/**
 * Extract the committed `references` paths from a config's text, in file order.
 * @param text - aggregate config contents (JSONC with comments).
 * @returns every `"path": "..."` inside the `references` array.
 */
export function extractReferences(text: string): string[] {
  const start = text.indexOf('"references"')
  if (start < 0) throw new Error('gen-tsconfig-references: aggregate config has no references block.')
  // The references array is the last array literal before the file's closing brace.
  const end = text.lastIndexOf(']')
  if (end <= start) throw new Error('gen-tsconfig-references: aggregate config references block is malformed.')
  const body = text.slice(start, end)
  const paths: string[] = []
  for (const match of body.matchAll(/"path"\s*:\s*"([^"]+)"/g)) {
    const path = match[1]
    if (path !== undefined) paths.push(path)
  }
  if (paths.length === 0) throw new Error('gen-tsconfig-references: aggregate config references block is empty.')
  return paths
}

/**
 * Render one references array body.
 * @param refs - sorted reference paths.
 * @returns the array literal body, one entry per line.
 */
export function renderReferences(refs: readonly string[]): string {
  return refs.map(ref => `    { "path": ${JSON.stringify(ref)} }`).join(',\n')
}

/**
 * Replace the committed references block with the generated body, preserving
 * everything outside the block (comments, `include`, `exclude`).
 * @param text - aggregate config contents.
 * @param refs - generated reference paths.
 * @returns the updated contents.
 */
export function writeReferences(text: string, refs: readonly string[]): string {
  const key = text.indexOf('"references"')
  if (key < 0) throw new Error('gen-tsconfig-references: aggregate config has no references block.')
  const open = text.indexOf('[', key)
  const close = text.indexOf(']', open + 1)
  if (open < 0 || close < 0) throw new Error('gen-tsconfig-references: aggregate config references block is malformed.')
  const body = renderReferences(refs)
  return `${text.slice(0, open + 1)}\n${body}\n${text.slice(close)}`
}

function compare(label: string, current: string[], expected: string[]): string[] {
  const issues: string[] = []
  const currentSet = new Set(current)
  const expectedSet = new Set(expected)
  for (const ref of expected) {
    if (!currentSet.has(ref)) issues.push(`${label}: missing reference ${ref}.`)
  }
  for (const ref of current) {
    if (!expectedSet.has(ref)) issues.push(`${label}: unexpected reference ${ref}.`)
  }
  if (issues.length === 0 && current.join('\n') !== expected.join('\n')) {
    issues.push(`${label}: references are the right set but not in generated (sorted) order; run \`pnpm run gen-tsconfig-references\`.`)
  }
  return issues
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const check = process.argv.includes('--check')
  const hostText = readFileSync(join(ROOT, HOST_CONFIG), 'utf8')
  const clientText = readFileSync(join(ROOT, CLIENT_CONFIG), 'utf8')
  const hostExpected = collectHostReferences(ROOT)
  const clientExpected = collectClientReferences(ROOT)
  process.stdout.write(`gen-tsconfig-references: host (${String(hostExpected.length)}): ${hostExpected.join(', ')}\n`)
  process.stdout.write(`gen-tsconfig-references: client (${String(clientExpected.length)}): ${clientExpected.join(', ')}\n`)
  const issues = [
    ...compare('tsconfig.host.json', extractReferences(hostText), hostExpected),
    ...compare('tsconfig.client.json', extractReferences(clientText), clientExpected),
  ]
  if (issues.length > 0) {
    for (const issue of issues) process.stderr.write(`gen-tsconfig-references: ${issue}\n`)
    if (check) {
      process.stderr.write('gen-tsconfig-references: stale; run `pnpm run gen-tsconfig-references`.\n')
      process.exitCode = 1
    } else {
      writeFileSync(join(ROOT, HOST_CONFIG), writeReferences(hostText, hostExpected))
      writeFileSync(join(ROOT, CLIENT_CONFIG), writeReferences(clientText, clientExpected))
      process.stdout.write('gen-tsconfig-references: rewrote aggregate references.\n')
    }
  } else {
    process.stdout.write('gen-tsconfig-references: aggregate references are current.\n')
  }
}
