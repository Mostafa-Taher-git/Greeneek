import { describe, expect, it } from 'vitest'
import { CraftError } from '../src/error.ts'
import {
  assertPilotManifest,
  CraftCatalog,
  loadPilotCatalog,
  parseManifest,
  PILOT_APP_IDS,
} from '../src/manifest.ts'
import type { CraftAppManifest } from '../src/types.ts'

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'testcraft',
    displayName: 'TestCraft',
    aliases: ['testy'],
    cliStem: 'testcraft',
    headlessSupported: true,
    minVersion: '1.2.3',
    attach: { supported: true, enabled: false, reason: 'gated' },
    launch: { headless: 'testcraft-cli --headless', connected: 'testcraft --control {jobRoot}' },
    roots: { read: 'workspace', write: 'job-out' },
    cancellation: 'child-process-kill',
    riskyCommandClasses: ['overwrite'],
    sources: [{ label: 'docs', url: 'https://example.test/docs', verified: false }],
    recipe: { name: 'craft-testcraft', description: 'test recipe', file: 'recipes/testcraft.md' },
    headless: {
      listMethod: 'command_list',
      toolFilter: ['command_list', 'render_preview'],
      artifactTools: ['render_preview'],
    },
  }
}

function expectInvalid(mutate: (manifest: Record<string, unknown>) => void, fragment: string): void {
  const manifest = validManifest()
  mutate(manifest)
  expect(() => parseManifest(manifest)).toThrow(expect.objectContaining({
    name: 'CraftError',
    code: 'CRAFT_MANIFEST_INVALID',
    message: expect.stringContaining(fragment) as unknown as string,
  }))
}

function nested(manifest: Record<string, unknown>, key: string): Record<string, unknown> {
  return manifest[key] as Record<string, unknown>
}

describe('bundled pilot catalog', () => {
  it('loads both pilot apps through the real package files', () => {
    expect(PILOT_APP_IDS).toEqual(['photocraft', 'pdfcraft'])
    const catalog = loadPilotCatalog()
    expect(catalog.apps().map(app => app.id)).toEqual(['photocraft', 'pdfcraft'])
    expect(catalog.require('photocraft').headless.artifactTools).toEqual(['render_preview', 'screenshot'])
    expect(catalog.require('PDFCRAFT').displayName).toBe('PdfCraft')
  })

  it('publishes declared provenance without a placeholder host', () => {
    for (const manifest of loadPilotCatalog().apps()) {
      expect(manifest.sources.length).toBeGreaterThan(0)
      expect(manifest.sources.some(source => !source.verified)).toBe(true)
      for (const source of manifest.sources) {
        expect(source.url).not.toContain('craft.example')
      }
    }
  })

  it('resolves a pre-rename alias and reads the recipe from the package', () => {
    const catalog = loadPilotCatalog()
    expect(catalog.find('printcraft')?.id).toBe('pdfcraft')
    expect(catalog.find('  PhotoCraft  ')?.id).toBe('photocraft')
    expect(catalog.find('figcraft')).toBeUndefined()
    const recipe = catalog.recipe('printcraft')
    expect(recipe.name).toBe('craft-pdfcraft')
    expect(recipe.content).toContain('PdfCraft headless recipe')
  })

  it('fails an unknown app with the pilot wording instead of crashing', () => {
    expect(() => loadPilotCatalog().require('figcraft')).toThrow(expect.objectContaining({
      code: 'CRAFT_APP_NOT_IN_PILOT',
      message: expect.stringContaining('is not in the v0.3.4 pilot') as unknown as string,
    }))
  })

  it('uses an injected reader for manifests and recipes', () => {
    const files = new Map<string, string>([
      ['manifests/photocraft.json', JSON.stringify({ ...validManifest(), id: 'photocraft' })],
      ['manifests/pdfcraft.json', JSON.stringify({ ...validManifest(), id: 'pdfcraft', aliases: [] })],
      ['recipes/testcraft.md', '  recipe body  '],
    ])
    const catalog = loadPilotCatalog(path => files.get(path) as string)
    expect(catalog.require('photocraft').id).toBe('photocraft')
    expect(catalog.recipe('photocraft').content).toBe('recipe body')
  })

  it('reports unreadable or mismatched pilot manifests', () => {
    expect(() => loadPilotCatalog(path => path.endsWith('photocraft.json') ? '{' : '{}'))
      .toThrow(expect.objectContaining({ code: 'CRAFT_MANIFEST_INVALID', message: expect.stringContaining('unable to read') as unknown as string }))
    expect(() => loadPilotCatalog(path => path.endsWith('photocraft.json') ? JSON.stringify(validManifest()) : '{}'))
      .toThrow(expect.objectContaining({ code: 'CRAFT_MANIFEST_INVALID', message: expect.stringContaining('must be "photocraft"') as unknown as string }))
    expect(() => loadPilotCatalog(() => {
      throw 'reader exploded'
    })).toThrow(expect.objectContaining({
      code: 'CRAFT_MANIFEST_INVALID',
      message: expect.stringContaining('reader exploded') as unknown as string,
    }))
  })

  it('rejects a pilot manifest that publishes attach mode', () => {
    const manifest = parseManifest({
      ...validManifest(),
      attach: { supported: true, enabled: true, reason: 'should not ship' },
    })
    expect(() => { assertPilotManifest(manifest) }).toThrow(expect.objectContaining({
      code: 'CRAFT_MANIFEST_INVALID',
      message: expect.stringContaining('pilot manifests must keep attach mode disabled') as unknown as string,
    }))
  })
})

describe('strict manifest validation', () => {
  it('accepts the canonical shape', () => {
    expect(parseManifest(validManifest())).toMatchObject({ id: 'testcraft', roots: { write: 'job-out' } })
  })

  it('rejects a non-object and unknown or missing fields', () => {
    expect(() => parseManifest(null)).toThrow(expect.objectContaining({ code: 'CRAFT_MANIFEST_INVALID', message: expect.stringContaining('manifest: must be an object') as unknown as string }))
    expect(() => parseManifest([])).toThrow(expect.objectContaining({ code: 'CRAFT_MANIFEST_INVALID' }))
    expectInvalid((manifest) => { manifest.extra = true }, 'extra: is not a recognized field')
    const missing = validManifest()
    delete missing.displayName
    expect(() => parseManifest(missing)).toThrow(expect.objectContaining({ message: expect.stringContaining('displayName: is required') as unknown as string }))
  })

  it('rejects every scalar contract violation', () => {
    expectInvalid((manifest) => { manifest.schemaVersion = 2 }, 'schemaVersion: must be 1')
    expectInvalid((manifest) => { manifest.id = 'Bad Id' }, 'id: must be a lowercase kebab-case id')
    expectInvalid((manifest) => { manifest.displayName = '  ' }, 'displayName: must be a non-empty string')
    expectInvalid((manifest) => { manifest.cliStem = 'Bad_Stem' }, 'cliStem: must be a lowercase executable stem')
    expectInvalid((manifest) => { manifest.headlessSupported = 'yes' }, 'headlessSupported: must be a boolean')
    expectInvalid((manifest) => { manifest.minVersion = '1.2' }, 'minVersion: must be a semantic version')
    expectInvalid((manifest) => { manifest.cancellation = 'graceful' }, 'cancellation: must be "child-process-kill"')
    expectInvalid((manifest) => { manifest.displayName = 7 }, 'displayName: must be a non-empty string')
  })

  it('rejects alias and string-array violations', () => {
    expectInvalid((manifest) => { manifest.aliases = 'testy' }, 'aliases: must be an array')
    expectInvalid((manifest) => { manifest.aliases = ['testy', 'testy'] }, 'aliases[1]: must be unique')
    expectInvalid((manifest) => { manifest.aliases = ['Bad Alias'] }, 'aliases[0]: must be a lowercase kebab-case id')
    expectInvalid((manifest) => { manifest.aliases = ['testcraft'] }, 'aliases: must not repeat the app id')
    expectInvalid((manifest) => { manifest.aliases = [3] }, 'aliases[0]: must be a non-empty string')
    expectInvalid((manifest) => { manifest.riskyCommandClasses = [] }, 'riskyCommandClasses: must not be empty')
  })

  it('rejects root, attach, launch, and source violations', () => {
    expectInvalid((manifest) => { nested(manifest, 'roots').read = 'home' }, 'roots.read: must be "workspace"')
    expectInvalid((manifest) => { nested(manifest, 'roots').write = 'workspace' }, 'roots.write: must be "job-out"')
    expectInvalid((manifest) => { nested(manifest, 'attach').supported = false; nested(manifest, 'attach').enabled = true }, 'attach.enabled: cannot be true when attach is unsupported')
    expectInvalid((manifest) => { nested(manifest, 'attach').reason = '' }, 'attach.reason: must be a non-empty string')
    expectInvalid((manifest) => { nested(manifest, 'launch').headless = '' }, 'launch.headless: must be a non-empty string')
    expectInvalid((manifest) => { nested(manifest, 'launch').connected = 4 }, 'launch.connected: must be a non-empty string')
    expectInvalid((manifest) => { manifest.sources = [] }, 'sources: must not be empty')
    expectInvalid((manifest) => { manifest.sources = 'docs' }, 'sources: must be an array')
    expectInvalid((manifest) => { manifest.sources = [null] }, 'sources[0]: must be an object')
    expectInvalid((manifest) => { (manifest.sources as Record<string, unknown>[])[0]!.extra = true }, 'sources[0].extra: is not a recognized field')
    expectInvalid((manifest) => { (manifest.sources as Record<string, unknown>[])[0]!.verified = 'no' }, 'sources[0].verified: must be a boolean')
  })

  it('rejects recipe and headless violations', () => {
    expectInvalid((manifest) => { nested(manifest, 'recipe').name = 'Craft Test' }, 'recipe.name: must be a kebab-case skill name')
    expectInvalid((manifest) => { nested(manifest, 'recipe').file = '../secret.md' }, 'recipe.file: must name a markdown file under recipes/')
    expectInvalid((manifest) => { nested(manifest, 'recipe').description = '' }, 'recipe.description: must be a non-empty string')
    expectInvalid((manifest) => { nested(manifest, 'headless').toolFilter = [] }, 'headless.toolFilter: must not be empty')
    expectInvalid((manifest) => { nested(manifest, 'headless').toolFilter = ['a', 'a'] }, 'headless.toolFilter[1]: must be unique')
    expectInvalid((manifest) => { nested(manifest, 'headless').toolFilter = [1] }, 'headless.toolFilter[0]: must be a non-empty string')
    expectInvalid((manifest) => { nested(manifest, 'headless').artifactTools = ['other'] }, 'headless.artifactTools: tool "other" must also appear in headless.toolFilter')
    expectInvalid((manifest) => { nested(manifest, 'headless').artifactTools = 'render_preview' }, 'headless.artifactTools: must be an array')
    expectInvalid((manifest) => { nested(manifest, 'headless').listMethod = '' }, 'headless.listMethod: must be a non-empty string')
  })
})

describe('catalog', () => {
  const manifest = parseManifest(validManifest())

  it('rejects an empty catalog and duplicate names', () => {
    expect(() => new CraftCatalog([])).toThrow(expect.objectContaining({ code: 'CRAFT_MANIFEST_INVALID' }))
    const other = parseManifest({ ...validManifest(), id: 'othercraft', aliases: ['testy'] })
    expect(() => new CraftCatalog([manifest, other])).toThrow(expect.objectContaining({
      message: expect.stringContaining('is claimed by both') as unknown as string,
    }))
  })

  it('rejects an empty recipe body and a non-manifest JSON payload', () => {
    const catalog = new CraftCatalog([manifest], () => '   ')
    expect(() => catalog.recipe('testcraft')).toThrow(expect.objectContaining({
      code: 'CRAFT_MANIFEST_INVALID',
      message: expect.stringContaining('must not be empty') as unknown as string,
    }))
    expect(() => parseManifest(JSON.parse('"text"'))).toThrow(expect.objectContaining({ code: 'CRAFT_MANIFEST_INVALID' }))
  })

  it('exposes the exact manifest object and stable error type', () => {
    const catalog = new CraftCatalog([manifest], () => 'body')
    expect(catalog.apps()).toEqual([manifest])
    const cause = new Error('root')
    const error = new CraftError('failed', 'CRAFT_ROOT_INVALID', { cause })
    expect(error.cause).toBe(cause)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CraftError')
  })
})

// Keep the manifest imports honest for type-only consumers.
const _typecheck: CraftAppManifest = parseManifest(validManifest())
void _typecheck
