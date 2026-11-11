/**
 * Gate: every hashed runtime chunk emitted under a package's `lib/` must be
 * reachable through that package's npm `files` allowlist.
 *
 * `tsdown` code-splits shared modules into hashed siblings such as
 * `lib/magic-string.es-DN3UIXcZ.js`. The webworker VFS packer publishes only
 * the `files` slice of each workspace package, so an undeclared chunk is
 * dropped from the image while an entry still imports it. `preview-boot`
 * catches that at boot on the Linux browser lane; this gate catches it in the
 * fast documentation lane, on every host, before a build is needed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

/** Convert an npm `files` glob into a matcher: `**` crosses directories, `*` does not. */
function globMatcher(pattern: string): (path: string) => boolean {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? ''
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (character === '*') {
      source += '[^/]*'
    } else if ('.+^${}()|[]\\?'.includes(character)) {
      source += `\\${character}`
    } else {
      source += character
    }
  }
  return (path: string) => new RegExp(`${source}$`).test(path)
}

/** Hashed chunk names carry a bundler hash before `.js`, unlike stable entries. */
const HASHED_CHUNK = /-[A-Za-z0-9_-]{6,}\.js$/u

interface Violation {
  readonly packageName: string
  readonly chunk: string
}

function undeclaredChunks(): Violation[] {
  const violations: Violation[] = []
  for (const group of readdirSync(join(root, 'packages'))) {
    const groupDir = join(root, 'packages', group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const name of readdirSync(groupDir)) {
      const packageDir = join(groupDir, name)
      const manifestPath = join(packageDir, 'package.json')
      const libDir = join(packageDir, 'lib')
      if (!existsSync(manifestPath) || !existsSync(libDir)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        readonly name?: string
        readonly files?: readonly string[]
      }
      const patterns = Array.isArray(manifest.files) ? manifest.files.map(globMatcher) : []
      for (const chunk of readdirSync(libDir).filter(file => HASHED_CHUNK.test(file))) {
        const relative = `lib/${chunk}`
        if (!patterns.some(matches => matches(relative))) {
          violations.push({ packageName: manifest.name ?? `${group}/${name}`, chunk: relative })
        }
      }
    }
  }
  return violations
}

describe('published runtime chunks', () => {
  it('declares every hashed lib chunk in the package files allowlist', () => {
    expect(undeclaredChunks(), 'an undeclared chunk is dropped from the VFS image').toEqual([])
  })

  it('fails the check when a hashed chunk is not declared', () => {
    // A hashed sibling that no pattern covers must be reported; this pins the
    // detector itself rather than only the current tree's clean state.
    const matcher = globMatcher('lib/types-*.js')
    expect(matcher('lib/magic-string.es-ABCDEFGH.js')).toBe(false)
    expect(globMatcher('lib/*-*.js')('lib/magic-string.es-ABCDEFGH.js')).toBe(true)
    expect(globMatcher('lib/types/**/*.js')('lib/types/nested/thing.js')).toBe(true)
  })
})
