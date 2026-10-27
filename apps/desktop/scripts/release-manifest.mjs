import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDesktopVersion, resolveReleaseTag } from './prepare-release-assets.mjs'

/**
 * Assemble the release provenance set: a `SHA256SUMS` file and a
 * `release-manifest.json` that pins every published byte to the tagged commit.
 * The release workflow downloads both platform artifact sets into one
 * directory, runs this once, and publishes exactly the files the manifest
 * lists. `--verify` re-hashes a downloaded set before publishing so a corrupt
 * or partially downloaded artifact cannot ship under a valid tag.
 */

const MANIFEST_NAME = 'release-manifest.json'
const CHECKSUMS_NAME = 'SHA256SUMS'
const OUTPUT_NAMES = new Set([MANIFEST_NAME, CHECKSUMS_NAME])

/** Versioned and stable-alias names the release set must carry per platform. */
export const REQUIRED_RELEASE_ASSETS = {
  linux: [
    /^Greeneek-Desktop-.+-linux-amd64\.deb$/,
    /^Greeneek-Desktop-.+-linux-x86_64\.AppImage$/,
  ],
  windows: [
    /^Greeneek-Desktop-.+-windows-x64\.exe$/,
    /^Greeneek-Desktop-.+-windows-x64\.zip$/,
  ],
}

export function listReleaseFiles(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && !OUTPUT_NAMES.has(entry.name)) files.push(full)
    }
  }
  walk(root)
  return files.sort()
}

export function hashFile(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', rejectHash)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function describeAssets(root) {
  const assets = []
  for (const full of listReleaseFiles(root)) {
    const name = basename(full)
    const size = statSync(full).size
    if (size === 0) throw new Error(`release asset is empty: ${relative(root, full)}`)
    assets.push({ name, relativePath: relative(root, full).split('\\').join('/'), size, sha256: await hashFile(full) })
  }
  return assets
}

function assertComplete(assets, { requireAllPlatforms }) {
  const names = assets.map(asset => asset.name)
  const missing = []
  for (const [platform, patterns] of Object.entries(REQUIRED_RELEASE_ASSETS)) {
    const found = patterns.filter(pattern => names.some(name => pattern.test(name)))
    if (requireAllPlatforms && found.length !== patterns.length) {
      missing.push(...patterns.filter(pattern => !found.includes(pattern)).map(pattern => `${platform}: ${pattern}`))
    }
  }
  if (requireAllPlatforms && missing.length > 0) {
    throw new Error(`release set is incomplete:\n${missing.join('\n')}\nfound:\n${names.join('\n')}`)
  }
}

function checksumText(assets) {
  return `${assets.map(asset => `${asset.sha256}  ${asset.relativePath}`).join('\n')}\n`
}

/**
 * Write `SHA256SUMS` and `release-manifest.json` for every file under `root`.
 * @param options - root directory, release tag, commit, and output directory.
 * @returns the manifest object that was written.
 */
export async function writeReleaseManifest({ root, tag, commit, outputDir = root, requireAllPlatforms = true, now = new Date() }) {
  const assets = await describeAssets(root)
  assertComplete(assets, { requireAllPlatforms })
  const manifest = {
    schemaVersion: 1,
    tag,
    version: parseDesktopVersion(tag),
    commit,
    generatedAt: now.toISOString(),
    assets: assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
  }
  writeFileSync(join(outputDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(outputDir, CHECKSUMS_NAME), checksumText(assets))
  return manifest
}

/**
 * Re-hash the files a manifest names and fail on any missing, resized, or
 * changed asset. Extra files are ignored: the manifest is the release set.
 * @param options - directory holding the assets and manifest path.
 * @returns the verified manifest object.
 */
export async function verifyReleaseManifest({ root, manifestPath = join(root, MANIFEST_NAME) }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || typeof manifest.commit !== 'string') {
    throw new Error(`release manifest is malformed: ${manifestPath}`)
  }
  const problems = []
  for (const asset of manifest.assets) {
    const full = join(root, asset.name)
    if (!existsSync(full)) {
      problems.push(`${asset.name} (missing)`)
      continue
    }
    const size = statSync(full).size
    if (size !== asset.size) problems.push(`${asset.name} (size ${size} != ${asset.size})`)
    const sha256 = await hashFile(full)
    if (sha256 !== asset.sha256) problems.push(`${asset.name} (sha256 ${sha256} != ${asset.sha256})`)
  }
  if (problems.length > 0) throw new Error(`release manifest verification failed:\n${problems.join('\n')}`)
  return manifest
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a value`)
  return value
}

async function main() {
  const root = argumentValue('--root') ?? 'release-assets'
  const manifestPath = join(root, MANIFEST_NAME)
  if (process.argv.includes('--verify')) {
    const manifest = await verifyReleaseManifest({ root, manifestPath })
    process.stdout.write(`Verified ${manifest.assets.length} release asset(s) for ${manifest.tag} at ${manifest.commit}.\n`)
    return
  }
  const tag = resolveReleaseTag(argumentValue('--tag'), process.env.GITHUB_REF_NAME)
  if (tag === '') throw new Error('--tag is required when GITHUB_REF_NAME is not a desktop-v* tag')
  const commit = argumentValue('--sha') ?? process.env.GITHUB_SHA
  if (!commit) throw new Error('--sha is required to bind the manifest to a commit')
  const requireAllPlatforms = !process.argv.includes('--allow-partial')
  const manifest = await writeReleaseManifest({ root, tag, commit, outputDir: argumentValue('--output') ?? root, requireAllPlatforms })
  process.stdout.write(`Wrote ${MANIFEST_NAME} and ${CHECKSUMS_NAME} for ${manifest.assets.length} asset(s) at ${tag}.\n`)
}

const isMainModule = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainModule) {
  await main().catch((error) => {
    console.error(`release-manifest: ${error.message}`)
    process.exitCode = 1
  })
}
