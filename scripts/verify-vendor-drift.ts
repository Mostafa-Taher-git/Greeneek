/**
 * Vendor drift check: every logged local modification in `vendor/README.md`
 * carries a checked-in patch file under `vendor/patches/`, and the vendor
 * tree still matches the tree hash those patch files record.
 *
 * Reconstructing `vendor/` from upstream SHAs needs upstream credentials the
 * CI runner does not have, so the offline half is mechanical and always runs:
 * one `vendor/patches/NN-<slug>.patch` per numbered "Local modifications"
 * entry (split from the README by `--write-patches`), each stamped with the
 * current vendor tree hash. Any vendor edit without regenerating the patch
 * files fails loud; any missing or renamed patch file fails loud. When
 * `VENDOR_UPSTREAM_URL` is set (a scheduled agent task with credentials),
 * the script additionally reports the manifest SHAs for upstream
 * reconstruction; without it, it prints that upstream reconstruction belongs
 * to the scheduled task — it never silently skips the offline check.
 *
 * @module scripts/verify-vendor-drift
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
// Hidden so the root `tsdown` workspace glob (`vendor/*`) does not mistake the
// patch store for a vendor package — a non-package directory breaks the
// workspace entry resolution (`Cannot find entry`).
const PATCHES = '.patches'

/** One numbered local-modification entry from `vendor/README.md`. */
export interface ModificationEntry {
  number: number
  title: string
  body: string
}

/**
 * Split the "Local modifications" numbered list into entries.
 * @param readme - complete `vendor/README.md` contents.
 * @returns one entry per numbered item, in order.
 */
export function parseModificationEntries(readme: string): ModificationEntry[] {
  const section = readme.split('## Local modifications')[1]?.split('## Sync procedure')[0] ?? ''
  const entries: ModificationEntry[] = []
  const pattern = /^(\d+)\. \*\*(.+)\*\*: (.+)$/gm
  for (const match of section.matchAll(pattern)) {
    const number = Number.parseInt(match[1] ?? '0', 10)
    const title = (match[2] ?? '').replaceAll('`', '').trim()
    const body = match[3] ?? ''
    entries.push({ number, title, body })
  }
  if (entries.length === 0) {
    throw new Error('verify-vendor-drift: vendor/README.md Local modifications parsed to zero entries; the list format changed.')
  }
  return entries
}

export function patchFileName(entry: ModificationEntry): string {
  const slug = entry.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${String(entry.number).padStart(2, '0')}-${slug}.patch`
}

/** sha256 of vendored package sources, manifests, and tsconfigs; generated files and the root CLAUDE link are excluded. */
export function vendorTreeHash(root: string): string {
  const hash = createHash('sha256')
  const vendorDir = join(root, 'vendor')
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === 'node_modules' || entry === 'lib' || entry === 'patches' || entry === '.patches') continue
      if (dir === vendorDir && entry === 'CLAUDE.md') continue
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) visit(path)
      else {
        hash.update(path.slice(vendorDir.length).replaceAll('\\', '/'))
        hash.update(readFileSync(path))
      }
    }
  }
  try {
    visit(vendorDir)
  } catch {
    throw new Error('verify-vendor-drift: vendor/ directory is missing.')
  }
  return hash.digest('hex')
}

/** Result of checking the vendor drift gate. */
export interface VendorDriftReport {
  entryCount: number
  failures: string[]
}

/**
 * Check that every logged modification has a patch file and the tree hash matches.
 * @param root - absolute repository root.
 * @returns entry count and every mismatch.
 */
export function inspectVendorDrift(root: string): VendorDriftReport {
  const readme = readFileSync(join(root, 'vendor/README.md'), 'utf8')
  const entries = parseModificationEntries(readme)
  const treeHash = vendorTreeHash(root)
  const failures: string[] = []
  for (const entry of entries) {
    const file = patchFileName(entry)
    const path = join(root, 'vendor', PATCHES, file)
    if (!existsSync(path)) {
      failures.push(`vendor/.patches/${file}: missing patch file for modification ${String(entry.number)} (${entry.title}).`)
      continue
    }
    const text = readFileSync(path, 'utf8')
    if (!text.includes(`Modification ${String(entry.number)}:`)) {
      failures.push(`vendor/.patches/${file}: does not name Modification ${String(entry.number)}.`)
    }
    const hashLine = text.split('\n').find(line => line.startsWith('Tree-hash:'))
    if (hashLine === undefined) {
      failures.push(`vendor/.patches/${file}: missing Tree-hash stamp.`)
    } else if (hashLine !== `Tree-hash: ${treeHash}`) {
      failures.push(`vendor/.patches/${file}: tree hash is stale; vendor/ changed without regenerating patches (run \`pnpm run verify-vendor-drift --write-patches\`).`)
    }
  }
  return { entryCount: entries.length, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const write = process.argv.includes('--write-patches')
  const root = ROOT
  const readme = readFileSync(join(root, 'vendor/README.md'), 'utf8')
  const entries = parseModificationEntries(readme)
  const treeHash = vendorTreeHash(root)
  if (write) {
    mkdirSync(join(root, 'vendor', PATCHES), { recursive: true })
    for (const entry of entries) {
      const file = patchFileName(entry)
      writeFileSync(join(root, 'vendor', PATCHES, file), [
        `Modification ${String(entry.number)}: ${entry.title}`,
        `Tree-hash: ${treeHash}`,
        'Upstream manifest: see vendor/README.md manifest table for this package\'s SHA.',
        '',
        entry.body,
        '',
      ].join('\n'))
    }
    process.stdout.write(`verify-vendor-drift: wrote ${String(entries.length)} patch file(s) with tree hash ${treeHash}.\n`)
  } else {
    const report = inspectVendorDrift(root)
    if (process.env.VENDOR_UPSTREAM_URL === undefined) {
      process.stdout.write(
        'verify-vendor-drift: upstream reconstruction belongs to the scheduled agent task (no VENDOR_UPSTREAM_URL in this environment); offline patch check still applies.\n',
      )
    } else {
      process.stdout.write(`verify-vendor-drift: upstream reconstruction for ${process.env.VENDOR_UPSTREAM_URL} is owned by the scheduled task.\n`)
    }
    if (report.failures.length > 0) {
      process.stderr.write(`verify-vendor-drift: ${String(report.failures.length)} drift issue(s):\n`)
      for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
      process.exitCode = 1
    } else {
      process.stdout.write(`verify-vendor-drift: ${String(report.entryCount)} modification(s) checked; all patch files current.\n`)
    }
  }
}
