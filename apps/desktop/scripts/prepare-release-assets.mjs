import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Stable `-latest-` download aliases for human links. The updater never uses
 * these; it reads the versioned filenames referenced inside `latest*.yml`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function releaseAssetMappings(version) {
  return [
    [`Greeneek-Desktop-${version}-linux-amd64.deb`, 'Greeneek-Desktop-latest-linux-amd64.deb'],
    [`Greeneek-Desktop-${version}-linux-x86_64.AppImage`, 'Greeneek-Desktop-latest-linux-x86_64.AppImage'],
    [`Greeneek-Desktop-${version}-windows-x64.exe`, 'Greeneek-Desktop-latest-windows-x64.exe'],
    [`Greeneek-Desktop-${version}-windows-x64.zip`, 'Greeneek-Desktop-latest-windows-x64.zip'],
  ]
}

export function prepareReleaseAssets({ distDir, version }) {
  const mappings = releaseAssetMappings(version)
  const missingAssets = mappings
    .map(([sourceName]) => sourceName)
    .filter((sourceName) => !existsSync(path.join(distDir, sourceName)))

  if (missingAssets.length > 0) {
    throw new Error(`Missing release assets:\n${missingAssets.join('\n')}`)
  }

  for (const [sourceName, aliasName] of mappings) {
    copyFileSync(path.join(distDir, sourceName), path.join(distDir, aliasName))
  }

  return mappings.map(([, aliasName]) => aliasName)
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a value`)
  return value
}

function main() {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const version = argumentValue('--version') ?? manifest.version
  const distDir = path.resolve(root, argumentValue('--dist') ?? 'dist')
  const aliases = prepareReleaseAssets({ distDir, version })
  process.stdout.write(`Prepared stable release aliases:\n${aliases.join('\n')}\n`)
}

const isMainModule = (process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
if (isMainModule) main()
