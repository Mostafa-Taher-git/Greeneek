import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * The Dependabot family lockstep contract: every package name inside a
 * `.github/dependabot.yml` group is declared and resolved at one version
 * across the workspace. Dependabot bumps a group as one unit because a
 * single-package bump leaves the workspace untypeable or unbuildable, so a
 * hand edit that moves one member ahead of its family reintroduces exactly
 * that breakage between Dependabot runs.
 *
 * Two planes carry the same requirement:
 * - declarations — the version ranges workspace `package.json` files state;
 * - resolutions — the versions `pnpm-lock.yaml` pins for those declarations.
 * Transitive copies under different peer sets (OpenTelemetry publishes its
 * api/sdk/exporter lines on disjoint majors) live outside `importers:` and
 * never belong to this contract.
 */

const root = resolve(import.meta.dirname, '..')

/** One declaration of a family member somewhere in the workspace. */
interface Occurrence {
  readonly family: string
  readonly name: string
  readonly version: string
  readonly file: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse one YAML file relative to the repository root.
 * @param path - file path relative to the repository root.
 * @returns the parsed document.
 */
function readYaml(path: string): Record<string, unknown> {
  const parsed: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(parsed)) throw new TypeError(`${path} must define a YAML mapping`)
  return parsed
}

/**
 * Extract the npm ecosystem's grouped families from Dependabot's config.
 * @returns one entry per family: its declared patterns.
 */
function dependabotFamilies(): ReadonlyMap<string, readonly string[]> {
  const config = readYaml('.github/dependabot.yml')
  const updates: unknown = config.updates
  if (!Array.isArray(updates)) throw new TypeError('dependabot.yml must define an updates list')
  const entries: readonly unknown[] = updates
  const npm = entries.find(entry => isRecord(entry) && entry['package-ecosystem'] === 'npm')
  if (!isRecord(npm)) throw new TypeError('dependabot.yml must define the npm ecosystem entry')
  const groups = npm.groups
  if (!isRecord(groups) || Object.keys(groups).length === 0) {
    throw new TypeError('the dependabot.yml npm entry must define at least one group')
  }
  const families = new Map<string, readonly string[]>()
  for (const [family, definition] of Object.entries(groups)) {
    if (!isRecord(definition) || !Array.isArray(definition.patterns) || definition.patterns.length === 0) {
      throw new TypeError(`dependabot.yml group ${family} must list package patterns`)
    }
    for (const pattern of definition.patterns) {
      if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new TypeError(`dependabot.yml group ${family} has a non-string or empty pattern`)
      }
      if (pattern.includes('*') && !pattern.endsWith('/*')) {
        throw new TypeError(`dependabot.yml group ${family} pattern "${pattern}" is not an exact name or a scope wildcard ending in "/*"`)
      }
    }
    families.set(family, definition.patterns as readonly string[])
  }
  return families
}

/**
 * Does one dependency name match one family's pattern list?
 * @param name - dependency name, e.g. `@lexical/history`.
 * @param patterns - the family's patterns from dependabot.yml.
 * @returns whether the name belongs to the family.
 */
function matchesFamily(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) return name.startsWith(pattern.slice(0, -1)) && name.length > pattern.length - 1
    return name === pattern
  })
}

/**
 * The version a declared range pins, with the range operator removed.
 * Fails loud on anything else (`workspace:`, ranges, tags): the lockstep
 * contract has no meaning for a floating or aliased family member, and a
 * family member must never be one.
 * @param spec - a declared dependency specifier.
 * @param file - declaring file, for the error message.
 * @param name - dependency name, for the error message.
 * @returns the bare semver version the range pins.
 */
function declaredVersion(spec: string, file: string, name: string): string {
  const match = spec.match(/^[~^]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][\w.-]+)?$/)
  if (match === null) {
    throw new TypeError(`${file}: ${name} declares "${spec}"; a Dependabot family member must be pinned to one semver version (^ or exact)`)
  }
  return spec.replace(/^[~^]/, '')
}

/**
 * The version the lockfile resolved, without its peer-suffix parenthetical.
 * @param version - a lockfile importer `version:` value.
 * @returns the resolved base version.
 */
function resolvedVersion(version: string): string {
  return version.slice(0, version.indexOf('(') === -1 ? undefined : version.indexOf('('))
}

/**
 * The dependency sections this contract reads from a manifest or importer.
 * @returns the section keys in stable order.
 */
function depSections(): readonly string[] {
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
}

/**
 * Resolve the workspace's package globs to member directories. Supports the
 * literal and single-segment `*` globs the manifest uses; anything broader
 * fails loud instead of scanning a silently narrowed or widened corpus.
 * @returns directory paths relative to the repository root, sorted.
 */
function workspaceMembers(): readonly string[] {
  const manifest = readYaml('pnpm-workspace.yaml')
  const globs = manifest.packages
  if (!Array.isArray(globs) || globs.length === 0) throw new TypeError('pnpm-workspace.yaml must list package globs')
  const members = new Set<string>()
  for (const glob of globs) {
    if (typeof glob !== 'string') throw new TypeError('pnpm-workspace.yaml package globs must be strings')
    if (glob.includes('**')) throw new TypeError(`pnpm-workspace.yaml glob "${glob}" is broader than this scanner supports; extend scripts/lockstep.spec.ts with it`)
    let candidates: readonly string[] = ['']
    for (const segment of glob.split('/')) {
      if (segment === '*') {
        candidates = candidates.flatMap((prefix) => {
          const dir = resolve(root, prefix)
          if (!existsSync(dir)) return []
          return readdirSync(dir).filter((name) => {
            if (name.startsWith('.')) return false
            const entry = resolve(dir, name)
            return statSync(entry).isDirectory()
          }).map(name => join(prefix, name))
        })
      } else {
        candidates = candidates.map(prefix => join(prefix, segment))
      }
    }
    for (const candidate of candidates) {
      if (existsSync(resolve(root, candidate, 'package.json'))) members.add(candidate.split('\\').join('/'))
    }
  }
  if (members.size === 0) throw new TypeError('pnpm-workspace.yaml globs resolved to no workspace members')
  return [...members].sort()
}

/**
 * Every declared dependency of one package.json, keyed by section.
 * @param file - member path relative to the repository root.
 * @returns the parsed dependency sections, or an empty mapping sections set.
 */
function readManifest(file: string): Readonly<Record<string, Record<string, string>>> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (!isRecord(parsed)) throw new TypeError(`${file} must be a JSON object`)
  const sections: Record<string, Record<string, string>> = {}
  for (const section of depSections()) {
    const declared = parsed[section]
    if (declared === undefined) continue
    if (!isRecord(declared)) throw new TypeError(`${file} section ${section} must be an object`)
    const specs: Record<string, string> = {}
    for (const [name, spec] of Object.entries(declared)) {
      if (typeof spec !== 'string') throw new TypeError(`${file}: ${name} specifier must be a string`)
      specs[name] = spec
    }
    sections[section] = specs
  }
  return sections
}

/**
 * Collect every family member declaration across the workspace manifests,
 * including the repository root's own manifest (the lockfile's `.` importer).
 * Mirrors Dependabot's `exclude-paths`: `vendor/**` pins its own upstream
 * ranges, so its declarations are outside what Dependabot keeps in lockstep.
 * @param families - family name to patterns.
 * @returns one occurrence per matching declaration.
 */
function declaredOccurrences(families: ReadonlyMap<string, readonly string[]>): readonly Occurrence[] {
  const found: Occurrence[] = []
  const manifests = ['', ...workspaceMembers()].map(dir => (dir === '' ? 'package.json' : `${dir}/package.json`))
  for (const file of manifests) {
    for (const specs of Object.values(readManifest(file))) {
      for (const [name, spec] of Object.entries(specs)) {
        for (const [family, patterns] of families) {
          if (!matchesFamily(name, patterns)) continue
          found.push({ family, name, version: declaredVersion(spec, file, name), file })
        }
      }
    }
  }
  return found
}

/**
 * Collect every family member resolution from the lockfile's importers — the
 * direct dependencies of the root and each workspace package.
 * @param families - family name to patterns.
 * @returns one occurrence per matching importer dependency.
 */
function resolvedOccurrences(families: ReadonlyMap<string, readonly string[]>): readonly Occurrence[] {
  const lockfile = readYaml('pnpm-lock.yaml')
  const importers = lockfile.importers
  if (!isRecord(importers)) throw new TypeError('pnpm-lock.yaml must define an importers mapping')
  const found: Occurrence[] = []
  for (const [file, entry] of Object.entries(importers)) {
    if (!isRecord(entry)) throw new TypeError(`lockfile importer ${file} must be a mapping`)
    for (const declared of Object.values(entry)) {
      if (!isRecord(declared)) continue
      for (const [name, pinned] of Object.entries(declared)) {
        if (!isRecord(pinned)) continue
        const version = pinned.version
        if (typeof version !== 'string') continue
        for (const [family, patterns] of families) {
          if (!matchesFamily(name, patterns)) continue
          if (version.startsWith('link:')) {
            throw new TypeError(`lockfile importer ${file} resolves ${name} as "${version}"; a Dependabot family member must come from the registry`)
          }
          found.push({ family, name, version: resolvedVersion(version), file: file === '.' ? 'package.json' : file })
        }
      }
    }
  }
  return found
}

/**
 * Family members allowed a second version line, keyed `family · name`. Each
 * entry names the allowed second major and the constraint that pins it; the
 * check fails stale — an exception whose second line has disappeared is a
 * leftover to delete, so it reports like drift.
 */
const EXCEPTION_MAJORS: ReadonlyMap<string, { major: number; reason: string }> = new Map([
  ['vite · vite', {
    major: 5,
    reason: 'vitepress 1.6.4 (the documentation website) pins vite ^5; moving off it needs the vitepress 2 migration',
  }],
])

/**
 * Group occurrences by family and package name, keeping only names that
 * resolved to more than one version. An excepted name reports when its
 * allowed second major is absent (stale exception) or a third line appeared.
 * @param occurrences - collected declarations or resolutions.
 * @returns rendered drift lines, empty when every name is single-version.
 */
function driftLines(occurrences: readonly Occurrence[]): readonly string[] {
  const grouped = new Map<string, Occurrence[]>()
  for (const occurrence of occurrences) {
    const key = `${occurrence.family} · ${occurrence.name}`
    const list = grouped.get(key) ?? []
    list.push(occurrence)
    grouped.set(key, list)
  }
  const lines: string[] = []
  for (const [key, list] of grouped) {
    const versions = new Set(list.map(occurrence => occurrence.version))
    if (versions.size <= 1) continue
    const exception = EXCEPTION_MAJORS.get(key)
    const majorOf = (version: string): number => Number(version.match(/^(\d+)/)?.[1] ?? -1)
    if (exception === undefined) {
      lines.push(`${key}:`)
    } else {
      const excepted = [...versions].filter(version => majorOf(version) === exception.major)
      const rest = [...versions].filter(version => majorOf(version) !== exception.major)
      if (excepted.length === 0) {
        lines.push(`${key}: stale exception (major ${exception.major} is gone — ${exception.reason})`)
      } else if (rest.length > 1) {
        lines.push(`${key} (second line ${exception.major} allowed: ${exception.reason}):`)
      } else {
        continue
      }
    }
    for (const version of [...versions].sort()) {
      const files = list.filter(occurrence => occurrence.version === version).map(occurrence => occurrence.file)
      lines.push(`  ${version} — ${files.join(', ')}`)
    }
  }
  return lines.sort()
}

describe('Dependabot family lockstep', () => {
  const families = dependabotFamilies()

  it('defines grouped families with supported patterns', () => {
    expect(families.size).toBeGreaterThanOrEqual(1)
    for (const patterns of families.values()) expect(patterns.length).toBeGreaterThanOrEqual(1)
  })

  it('declares each family package name at one version across the workspace', () => {
    expect(driftLines(declaredOccurrences(families))).toEqual([])
  })

  it('resolves each family package name to one version across the lockfile importers', () => {
    expect(driftLines(resolvedOccurrences(families))).toEqual([])
  })
})
