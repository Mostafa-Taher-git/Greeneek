/**
 * Keep one product version across first-party manifests and generated API
 * reports. The root manifest is authoritative: `release:gnk` bumps the gnk
 * family from it, and Desktop carries the same version for its About screen
 * while keeping its own `desktop-v*` tag namespace.
 *
 * Vendor, fixture, landing, and website versions are independent and excluded.
 * @module scripts/verify-product-version
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** A first-party manifest participating in the product version. */
export interface ProductManifest {
  readonly path: string
  readonly name: string
  readonly version: string | undefined
}

/** A generated API report header. */
export interface ApiReportHeader {
  readonly path: string
  readonly name: string
  readonly version: string
}

const PRODUCT_PREFIX = '@greeneek/gnk-'
const DESKTOP_NAME = '@greeneek/desktop'

/**
 * Whether a package name belongs to the first-party product version.
 * @param name - package name from a manifest or API report header.
 * @returns True for the gnk family and the Desktop deployment root.
 */
export function isProductName(name: string): boolean {
  return name.startsWith(PRODUCT_PREFIX) || name === DESKTOP_NAME
}

/**
 * Find manifests whose version differs from the product version.
 * @param productVersion - authoritative version from the root manifest.
 * @param manifests - first-party manifests to inspect.
 * @returns Actionable messages, one per drifting manifest.
 */
export function manifestDrift(productVersion: string, manifests: readonly ProductManifest[]): string[] {
  return manifests
    .filter(manifest => manifest.version !== productVersion)
    .map(manifest => `${manifest.path} declares ${manifest.version ?? 'no version'}; expected ${productVersion}`)
}

/**
 * Find first-party API reports whose header version differs from the product version.
 * @param productVersion - authoritative version from the root manifest.
 * @param reports - generated API report headers to inspect.
 * @returns Actionable messages, one per drifting report.
 */
export function apiReportDrift(productVersion: string, reports: readonly ApiReportHeader[]): string[] {
  return reports
    .filter(report => isProductName(report.name) && report.version !== productVersion)
    .map(report => `${report.path} reports ${report.name}@${report.version}; expected ${productVersion}`)
}

/** Read the header of one generated API report, when it has one. */
function readHeader(path: string, root: string): ApiReportHeader | undefined {
  const text = readFileSync(resolve(root, path), 'utf8')
  const match = /^# API report: (\S+)@(\S+) \(/m.exec(text)
  if (match === null) return undefined
  return { path, name: match[1] ?? '', version: match[2] ?? '' }
}

const isMainModule = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(import.meta.dirname, 'verify-product-version.ts')
if (isMainModule) {
  const root = resolve(import.meta.dirname, '..')
  const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof rootManifest.version !== 'string' || rootManifest.version === '') {
    throw new Error('verify-product-version: root package.json must declare a version')
  }
  const version = rootManifest.version
  const manifestPaths = [...globSync('packages/**/package.json', { cwd: root }), ...globSync('apps/**/package.json', { cwd: root })]
    .filter(path => !path.includes('node_modules'))
    .map(path => path.replaceAll('\\', '/'))
  const manifests: ProductManifest[] = []
  for (const path of manifestPaths) {
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as { name?: unknown; version?: unknown }
    if (typeof manifest.name !== 'string' || !isProductName(manifest.name)) continue
    manifests.push({
      path,
      name: manifest.name,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
    })
  }
  if (!manifests.some(manifest => manifest.name === DESKTOP_NAME)
    || !manifests.some(manifest => manifest.path.startsWith('packages/'))) {
    throw new Error('verify-product-version: manifest discovery is narrowed; expected packages and Desktop')
  }
  const reports = globSync('etc/*.api.md', { cwd: root })
    .map(path => readHeader(path, root))
    .filter((header): header is ApiReportHeader => header !== undefined)
  if (reports.length === 0) throw new Error('verify-product-version: no API report headers were found')

  const problems = [...manifestDrift(version, manifests), ...apiReportDrift(version, reports)]
  if (problems.length > 0) {
    console.error(`verify-product-version: ${problems.length} drift(s):\n${problems.map(line => `  ${line}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(`verify-product-version: ${manifests.length} manifests and ${reports.length} API reports agree on ${version}.`)
  }
}
