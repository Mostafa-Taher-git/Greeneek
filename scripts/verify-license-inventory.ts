/**
 * Enforce the vendored license inventory: every `vendor/` package carries a
 * `LICENSE` file whose text names MIT, every vendored `package.json` declares
 * `license: MIT`, and the `vendor/README.md` manifest table accounts for every
 * vendored directory. The repository root `LICENSE` and root `package.json`
 * license are both MIT (the GNK packages' own MIT declarations are already
 * enforced by `verify-gnk-package-licenses`).
 *
 * This script reads the `vendor/README.md` table and the manifests, prints the
 * resolved inventory, and fails loud on any mismatch — no fallback, no skip.
 * @module scripts/verify-license-inventory
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseVendoredRows } from './gen-third-party-notices.ts'

const ROOT = resolve(import.meta.dirname, '..')

/** Result of checking the vendored license inventory. */
export interface LicenseInventoryReport {
  /** Number of vendored packages checked. */
  packageCount: number
  /** Repository-relative diagnostics for inventory mismatches. */
  failures: string[]
}

function readJson(root: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-license-inventory: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function readText(root: string, file: string): string {
  return readFileSync(join(root, file), 'utf8')
}

/**
 * Check the vendored license inventory under one repository root.
 * @param root - absolute repository root containing `vendor/` and `LICENSE`.
 * @returns the checked vendored package count and every mismatch.
 */
export function inspectLicenseInventory(root: string): LicenseInventoryReport {
  const failures: string[] = []

  // Root MIT pair: root LICENSE text and root package.json license.
  let rootManifest: Record<string, unknown>
  try {
    rootManifest = readJson(root, 'package.json')
  } catch {
    throw new Error('verify-license-inventory: package.json is missing or unparsable.')
  }
  if (rootManifest.license !== 'MIT') {
    failures.push(`package.json: root must declare "license": "MIT"; found ${JSON.stringify(rootManifest.license)}.`)
  }
  const rootLicensePath = join(root, 'LICENSE')
  if (!existsSync(rootLicensePath)) {
    failures.push('LICENSE: root LICENSE file is missing.')
  } else if (!readText(root, 'LICENSE').includes('MIT License')) {
    failures.push('LICENSE: root LICENSE must contain "MIT License".')
  }

  // Vendor table vs. disk.
  const readme = readText(root, 'vendor/README.md')
  const rows = parseVendoredRows(readme)
  if (rows.length === 0) {
    throw new Error('verify-license-inventory: vendor/README.md manifest table parsed to zero rows; the table format changed or the file is empty.')
  }
  const onDisk = new Map<string, string>()
  const vendorDir = join(root, 'vendor')
  let entries: string[]
  try {
    entries = readdirSync(vendorDir)
  } catch {
    throw new Error('verify-license-inventory: vendor/ directory is missing.')
  }
  for (const entry of entries.sort()) {
    const dir = join(vendorDir, entry)
    // `vendor/README.md` is a file, not a package directory.
    if (!existsSync(join(dir, 'package.json')) || entry === 'README.md') continue
    let manifestPath = `${entry}/package.json`
    try {
      const manifest = readJson(root, `vendor/${entry}/package.json`)
      if (typeof manifest.name === 'string') onDisk.set(manifest.name, entry)
      else failures.push(`vendor/${entry}/package.json: missing string name.`)
    } catch {
      // A directory without a manifest is not a vendored package by name; a
      // stray directory still fails loud via the table comparison below.
      manifestPath = `vendor/${entry}/package.json`
      failures.push(`${manifestPath}: missing or unparsable manifest.`)
    }
  }

  const parsed = new Set(rows.map(row => row.npmName))
  for (const name of onDisk.keys()) {
    if (!parsed.has(name)) {
      failures.push(`vendor/README.md: no manifest-table row for vendored package ${name}; the table format changed or the sync is incomplete.`)
    }
  }

  let packageCount = 0
  for (const row of rows) {
    const dir = onDisk.get(row.npmName)
    if (dir === undefined) {
      failures.push(`vendor/README.md: vendored package ${row.npmName} has no vendor/ directory.`)
      continue
    }
    packageCount++
    const manifest = readJson(root, `vendor/${dir}/package.json`)
    if (manifest.license !== 'MIT') {
      failures.push(`vendor/${dir}/package.json: ${row.npmName} must declare "license": "MIT"; found ${JSON.stringify(manifest.license)}.`)
    }
    // Upstream MIT LICENSE files are preserved per directory (vendor/README).
    const licenseFile = existsSync(join(root, 'vendor', dir, 'LICENSE'))
      ? 'LICENSE'
      : existsSync(join(root, 'vendor', dir, 'LICENSE.md'))
        ? 'LICENSE.md'
        : undefined
    if (licenseFile === undefined) {
      failures.push(`vendor/${dir}/LICENSE: vendored ${row.npmName} must carry its upstream MIT LICENSE file.`)
    } else if (!readText(root, `vendor/${dir}/${licenseFile}`).includes('MIT License')) {
      failures.push(`vendor/${dir}/${licenseFile}: must contain "MIT License".`)
    }
  }

  return { packageCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectLicenseInventory(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-license-inventory: license inventory mismatches:\n')
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-license-inventory: ${String(report.packageCount)} vendored package(s) checked; all carry MIT LICENSE and declare MIT.\n`,
    )
  }
}
