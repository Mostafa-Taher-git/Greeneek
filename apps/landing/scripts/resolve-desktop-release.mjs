/**
 * Pin the download buttons to a specific `desktop-v*` release.
 *
 * GitHub's repo-wide `/releases/latest` can be shadowed by the npm `v*` family,
 * so the landing never uses it. This script resolves the newest desktop release
 * that actually carries every installer alias and writes the result next to
 * `platform.ts`. A failed lookup keeps the committed fallback: an old link that
 * still resolves beats a build that cannot start.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const API = 'https://api.github.com/repos/Mostafa-Taher-git/Greeneek/releases?per_page=100'
const TARGET = fileURLToPath(new URL('../src/lib/desktop-release.json', import.meta.url))
const REQUIRED = [
  'Greeneek-Desktop-latest-windows-x64.exe',
  'Greeneek-Desktop-latest-windows-x64.zip',
  'Greeneek-Desktop-latest-linux-amd64.deb',
  'Greeneek-Desktop-latest-linux-x86_64.AppImage',
]

function current() {
  try {
    return JSON.parse(readFileSync(TARGET, 'utf8'))
  } catch {
    return null
  }
}

const fallback = current()
if (fallback === null) throw new Error('landing: missing committed desktop-release.json fallback')

try {
  const response = await fetch(API, { headers: { accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`GitHub returned ${String(response.status)}`)
  const releases = await response.json()
  const candidate = releases
    .filter(release => /^desktop-v\d+\.\d+\.\d+$/.test(release.tag_name ?? ''))
    .filter(release => {
      const names = new Set((release.assets ?? []).map(asset => asset.name))
      return REQUIRED.every(name => names.has(name))
    })
    .sort((a, b) => a.tag_name.localeCompare(b.tag_name, undefined, { numeric: true }))
    .at(-1)
  if (candidate === undefined) throw new Error('no desktop release carries the full asset set')
  const manifest = { tag: candidate.tag_name, assets: REQUIRED }
  if (manifest.tag !== fallback.tag) {
    writeFileSync(TARGET, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`landing: pinned downloads to ${manifest.tag}`)
  } else console.log(`landing: downloads already pinned to ${manifest.tag}`)
} catch (error) {
  console.warn(`landing: keeping fallback ${fallback.tag}: ${String(error).slice(0, 160)}`)
}
