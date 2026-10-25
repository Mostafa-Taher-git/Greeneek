/**
 * Strict manifest parser, pilot catalog loader, and recipe reader.
 *
 * Manifests are release artifacts, not configuration: an unknown field or an
 * out-of-contract enum is a hard load failure, because silently ignoring a typo
 * could weaken a security rule (roots, token, attach) without any signal.
 * @module @greeneek/gnk-craft/manifest
 */

import { readFileSync } from 'node:fs'
import { CraftError } from './error.ts'
import type {
  CraftAppManifest,
  CraftHeadlessSpec,
  CraftLaunchTemplates,
  CraftManifestRoots,
  CraftManifestSource,
  CraftRecipe,
  CraftRecipeRef,
} from './types.ts'

/** The only apps the v0.3.4 pilot may load. */
export const PILOT_APP_IDS = ['photocraft', 'pdfcraft'] as const

/** Reads one package-relative file. */
export type ManifestReader = (relativePath: string) => string

/**
 * Default reader for bundled manifests and recipes.
 *
 * The source file lives at `src/manifest.ts` and the bundled entry at
 * `lib/index.js`, so `../` resolves to the package root in both layouts and
 * the declared `files` entries ship the target.

 * @param relativePath - package-relative path such as `manifests/photocraft.json`.
 * @returns file contents.
 */
export const readPackageFile: ManifestReader = relativePath =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

/** App id / alias grammar shared by manifests and lookup. */
const APP_ID = /^[a-z][a-z0-9-]{1,31}$/
/** CLI stem grammar. */
const CLI_STEM = /^[a-z][a-z0-9-]*$/
/** Semantic version grammar used by `minVersion`. */
const VERSION = /^\d+\.\d+\.\d+$/
/** Recipe file grammar keeps reads inside the package's `recipes/` directory. */
const RECIPE_FILE = /^recipes\/[a-z0-9-]+\.md$/
/** Skill name grammar, mirrored from `gnk-skill`. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Throw one manifest failure with a path-qualified detail. */
function invalid(path: string, detail: string): never {
  throw new CraftError(`invalid Craft manifest at ${path}: ${detail}`, 'CRAFT_MANIFEST_INVALID')
}

/** Narrow to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one object with exactly the allowed keys, all present. */
function strictRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) invalid(path, 'must be an object')
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path}.${key}`, 'is not a recognized field')
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'is required')
  }
  return value
}

/** Require a non-empty string. */
function stringField(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(path, 'must be a non-empty string')
  return value
}

/** Require a string matching one grammar. */
function patternField(value: unknown, path: string, pattern: RegExp, expectation: string): string {
  const text = stringField(value, path)
  if (!pattern.test(text)) invalid(path, `must ${expectation}`)
  return text
}

/** Require a boolean. */
function booleanField(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'must be a boolean')
  return value
}

/** Require an array of unique non-empty strings. */
function stringArray(
  value: unknown,
  path: string,
  options: { readonly unique: boolean; readonly nonEmpty: boolean },
): readonly string[] {
  if (!Array.isArray(value)) invalid(path, 'must be an array')
  const seen = new Set<string>()
  const result: string[] = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      invalid(`${path}[${String(index)}]`, 'must be a non-empty string')
    }
    if (options.unique && seen.has(entry)) invalid(`${path}[${String(index)}]`, 'must be unique')
    seen.add(entry)
    result.push(entry)
  }
  if (options.nonEmpty && result.length === 0) invalid(path, 'must not be empty')
  return result
}

/** Parse the exact roots contract: workspace read, job `out/` write. */
function parseRoots(value: unknown): CraftManifestRoots {
  const record = strictRecord(value, 'roots', ['read', 'write'])
  const read = stringField(record.read, 'roots.read')
  const write = stringField(record.write, 'roots.write')
  if (read !== 'workspace') invalid('roots.read', 'must be "workspace"')
  if (write !== 'job-out') invalid('roots.write', 'must be "job-out"')
  return { read: 'workspace', write: 'job-out' }
}

/** Parse one provenance entry. */
function parseSource(value: unknown, index: number): CraftManifestSource {
  const path = `sources[${String(index)}]`
  const record = strictRecord(value, path, ['label', 'url', 'verified'])
  return {
    label: stringField(record.label, `${path}.label`),
    url: stringField(record.url, `${path}.url`),
    verified: booleanField(record.verified, `${path}.verified`),
  }
}

/** Parse the recipe reference. */
function parseRecipeRef(value: unknown): CraftRecipeRef {
  const record = strictRecord(value, 'recipe', ['name', 'description', 'file'])
  return {
    name: patternField(record.name, 'recipe.name', SKILL_NAME, 'be a kebab-case skill name'),
    description: stringField(record.description, 'recipe.description'),
    file: patternField(record.file, 'recipe.file', RECIPE_FILE, 'name a markdown file under recipes/'),
  }
}

/** Parse headless protocol metadata. */
function parseHeadless(value: unknown): CraftHeadlessSpec {
  const record = strictRecord(value, 'headless', ['listMethod', 'toolFilter', 'artifactTools'])
  const toolFilter = stringArray(record.toolFilter, 'headless.toolFilter', { unique: true, nonEmpty: true })
  const artifactTools = stringArray(record.artifactTools, 'headless.artifactTools', {
    unique: true,
    nonEmpty: false,
  })
  for (const tool of artifactTools) {
    if (!toolFilter.includes(tool)) {
      invalid('headless.artifactTools', `tool "${tool}" must also appear in headless.toolFilter`)
    }
  }
  return {
    listMethod: stringField(record.listMethod, 'headless.listMethod'),
    toolFilter,
    artifactTools,
  }
}

/** Parse launch templates. */
function parseLaunch(value: unknown): CraftLaunchTemplates {
  const record = strictRecord(value, 'launch', ['headless', 'connected'])
  return {
    headless: stringField(record.headless, 'launch.headless'),
    connected: stringField(record.connected, 'launch.connected'),
  }
}

/** Parse the attach policy and enforce its internal consistency. */
function parseAttach(value: unknown): CraftAppManifest['attach'] {
  const record = strictRecord(value, 'attach', ['supported', 'enabled', 'reason'])
  const supported = booleanField(record.supported, 'attach.supported')
  const enabled = booleanField(record.enabled, 'attach.enabled')
  const reason = stringField(record.reason, 'attach.reason')
  if (enabled && !supported) invalid('attach.enabled', 'cannot be true when attach is unsupported')
  return { supported, enabled, reason }
}

/**
 * Validate one manifest value.
 * @param value - decoded JSON (or a programmatic object).
 * @returns the immutable manifest.
 */
export function parseManifest(value: unknown): CraftAppManifest {
  const record = strictRecord(value, 'manifest', [
    'schemaVersion',
    'id',
    'displayName',
    'aliases',
    'cliStem',
    'headlessSupported',
    'minVersion',
    'attach',
    'launch',
    'roots',
    'cancellation',
    'riskyCommandClasses',
    'sources',
    'recipe',
    'headless',
  ])
  if (record.schemaVersion !== 1) invalid('schemaVersion', 'must be 1')
  const id = patternField(record.id, 'id', APP_ID, 'be a lowercase kebab-case id')
  const aliases = stringArray(record.aliases, 'aliases', { unique: true, nonEmpty: false })
    .map((alias, index) => patternField(alias, `aliases[${String(index)}]`, APP_ID, 'be a lowercase kebab-case id'))
  if (aliases.includes(id)) invalid('aliases', 'must not repeat the app id')
  if (!Array.isArray(record.sources)) invalid('sources', 'must be an array')
  const sources = record.sources.map((source, index) => parseSource(source, index))
  if (sources.length === 0) invalid('sources', 'must not be empty')
  const cancellation = stringField(record.cancellation, 'cancellation')
  if (cancellation !== 'child-process-kill') invalid('cancellation', 'must be "child-process-kill"')
  return {
    schemaVersion: 1,
    id,
    displayName: stringField(record.displayName, 'displayName'),
    aliases,
    cliStem: patternField(record.cliStem, 'cliStem', CLI_STEM, 'be a lowercase executable stem'),
    headlessSupported: booleanField(record.headlessSupported, 'headlessSupported'),
    minVersion: patternField(record.minVersion, 'minVersion', VERSION, 'be a semantic version'),
    attach: parseAttach(record.attach),
    launch: parseLaunch(record.launch),
    roots: parseRoots(record.roots),
    cancellation: 'child-process-kill',
    riskyCommandClasses: stringArray(record.riskyCommandClasses, 'riskyCommandClasses', {
      unique: true,
      nonEmpty: true,
    }),
    sources,
    recipe: parseRecipeRef(record.recipe),
    headless: parseHeadless(record.headless),
  }
}

/**
 * Enforce the pilot security posture on a loaded manifest. Attach mode is
 * published only behind `security.attachEnabled`; pilot manifests must keep it
 * false so no code path can open a live GUI session.
 * @param manifest - parsed pilot manifest.
 */
export function assertPilotManifest(manifest: CraftAppManifest): void {
  if (manifest.attach.enabled) {
    invalid(`${manifest.id}.attach.enabled`, 'pilot manifests must keep attach mode disabled')
  }
}

/**
 * Catalog of manifests addressable by canonical id or alias.
 */
export class CraftCatalog {
  private readonly byName = new Map<string, CraftAppManifest>()
  private readonly manifests: readonly CraftAppManifest[]
  private readonly read: ManifestReader

  /**
   * @param manifests - validated manifests; ids and aliases must be globally unique.
   * @param read - package file reader used for recipes.
   */
  constructor(manifests: readonly CraftAppManifest[], read: ManifestReader = readPackageFile) {
    if (manifests.length === 0) invalid('catalog', 'must contain at least one manifest')
    this.manifests = manifests
    this.read = read
    for (const manifest of manifests) {
      for (const name of [manifest.id, ...manifest.aliases]) {
        const existing = this.byName.get(name)
        if (existing !== undefined) {
          invalid(`catalog.${name}`, `is claimed by both "${existing.id}" and "${manifest.id}"`)
        }
        this.byName.set(name, manifest)
      }
    }
  }

  /**
   * Every manifest in catalog order.
   * @returns the registered app manifests, unmodified.
   */
  apps(): readonly CraftAppManifest[] {
    return this.manifests
  }

  /**
   * Resolve one app id or alias.
   * @param app - requested id or alias (case-insensitive).
   * @returns the manifest, or undefined when it is not part of this catalog.
   */
  find(app: string): CraftAppManifest | undefined {
    return this.byName.get(app.trim().toLowerCase())
  }

  /**
   * Resolve one app id or alias or fail with `CRAFT_APP_NOT_IN_PILOT`.
   * @param app - requested id or alias.
   * @returns the manifest.
   */
  require(app: string): CraftAppManifest {
    const manifest = this.find(app)
    if (manifest === undefined) {
      throw new CraftError(
        `Craft app "${app}" is not in the v0.3.4 pilot (known: ${this.manifests.map(entry => entry.id).join(', ')})`,
        'CRAFT_APP_NOT_IN_PILOT',
      )
    }
    return manifest
  }

  /**
   * Load one app's recipe skill body.
   * @param app - canonical id or alias.
   * @returns the recipe content.
   */
  recipe(app: string): CraftRecipe {
    const manifest = this.require(app)
    const content = this.read(manifest.recipe.file).trim()
    if (content.length === 0) invalid(`${manifest.id}.recipe.file`, 'must not be empty')
    return {
      name: manifest.recipe.name,
      description: manifest.recipe.description,
      content,
    }
  }
}

/**
 * Load the two bundled pilot manifests.
 * @param read - package file reader (tests may substitute one).
 * @returns the validated pilot catalog.
 */
export function loadPilotCatalog(read: ManifestReader = readPackageFile): CraftCatalog {
  const manifests = PILOT_APP_IDS.map((id) => {
    let decoded: unknown
    try {
      decoded = JSON.parse(read(`manifests/${id}.json`))
    } catch (error: unknown) {
      throw new CraftError(
        `unable to read the bundled ${id} manifest: ${error instanceof Error ? error.message : String(error)}`,
        'CRAFT_MANIFEST_INVALID',
        { cause: error },
      )
    }
    const manifest = parseManifest(decoded)
    if (manifest.id !== id) invalid(`${id}.id`, `must be "${id}"`)
    assertPilotManifest(manifest)
    return manifest
  })
  return new CraftCatalog(manifests, read)
}
