import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Stamp the desktop version from a release tag: `desktop-v1.2.3` → `1.2.3`.
 * Tag, package version, and updater channel agree by construction. Local
 * builds keep the checked-in version; CI runs this on tag builds only.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function main() {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ''
  const match = /^desktop-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag.trim())
  if (!match) {
    console.error(`stamp-version: expected a desktop-v* tag, got ${JSON.stringify(tag)}`)
    process.exit(1)
  }
  const version = match[1]
  const manifestPath = join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.version = version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`stamp-version: package version set to ${version}`)
}

const isMainModule = (process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === join(process.cwd(), process.argv[1]))
  || process.argv[1]?.endsWith('/stamp-version.mjs')
  || process.argv[1]?.endsWith('\\stamp-version.mjs')
if (isMainModule) main()
