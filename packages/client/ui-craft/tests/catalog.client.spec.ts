/**
 * Pilot catalog spec: the browser mirror matches both shipped manifests
 * (id, display name, aliases, artifact tools), the keyed toolview list is
 * derived rather than hand-written, and the no-bridge source never fabricates
 * an installation state.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_TOOL_KEYS, artifactTarget, fallbackRows, fallbackSource, PILOT_APPS,
} from '../src/client/catalog.ts'

interface Manifest {
  readonly id: string
  readonly displayName: string
  readonly aliases: readonly string[]
  readonly headless: { readonly artifactTools: readonly string[] }
}

function manifest(name: string): Manifest {
  const url = new URL(`../../../craft/craft/manifests/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as Manifest
}

describe('PILOT_APPS', () => {
  it('mirrors every shipped manifest exactly', () => {
    for (const app of PILOT_APPS) {
      const shipped = manifest(app.id)
      expect(app).toMatchObject({
        id: shipped.id,
        displayName: shipped.displayName,
        aliases: shipped.aliases,
        artifactTools: shipped.headless.artifactTools,
      })
    }
    expect(PILOT_APPS.map(app => app.id)).toEqual(['photocraft', 'pdfcraft'])
  })

  it('derives the keyed toolview list from the manifest artifact tools', () => {
    expect([...ARTIFACT_TOOL_KEYS]).toEqual([
      'mcp__photocraft__render_preview',
      'mcp__photocraft__screenshot',
      'mcp__pdfcraft__command_run',
      'mcp__pdfcraft__command_batch',
      'mcp__pdfcraft__render_preview',
      'mcp__pdfcraft__doc_create_multiple',
      'mcp__pdfcraft__doc_export_images',
      'mcp__pdfcraft__doc_save',
    ])
  })
})

describe('artifactTarget', () => {
  it('resolves the owning app for a bridge tool name', () => {
    expect(artifactTarget('mcp__photocraft__screenshot')?.id).toBe('photocraft')
    expect(artifactTarget('mcp__pdfcraft__render_preview')?.id).toBe('pdfcraft')
  })

  it('returns undefined for a non-artifact tool', () => {
    expect(artifactTarget('mcp__photocraft__command_run')).toBeUndefined()
    expect(artifactTarget('craft_list_apps')).toBeUndefined()
  })
})

describe('fallback catalog', () => {
  it('reports every pilot app as unavailable with its links intact', () => {
    const rows = fallbackRows()
    expect(rows.map(row => row.state)).toEqual(['unavailable', 'unavailable'])
    expect(rows.map(row => row.id)).toEqual(['photocraft', 'pdfcraft'])
    expect(rows[0]!.launcherUrl).toBe('https://craft.example/open/photocraft')
    expect(rows[1]!.downloadUrl).toBe('https://craft.example/download/pdfcraft')
    expect(rows.every(row => row.detail === undefined)).toBe(true)
  })

  it('answers reads and actions with the same unavailable rows', async () => {
    const source = fallbackSource()
    const rows = await source.available()
    expect(rows).toHaveLength(2)
    expect(await source.check('pdfcraft')).toBe(rows[1])
    expect(await source.launchConnected('photocraft')).toBe(rows[0])
  })

  it('rejects an unknown app id instead of guessing a row', async () => {
    const source = fallbackSource()
    await expect(source.check('ghost')).rejects.toThrow('"ghost" is not a pilot app')
    await expect(source.launchConnected('ghost')).rejects.toThrow('"ghost" is not a pilot app')
  })
})
