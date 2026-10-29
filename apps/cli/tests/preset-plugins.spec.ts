/**
 * Every plugin a shipped preset row can start must be part of the profile
 * install closure. The Web profile layers the base and web-app bundles over
 * this CLI's production dependencies; a row that is only a devDependency is
 * discovered as broken on the roster card and fails when the mode is selected
 * (Maestro's Team tool was the first such omission).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SHIPPED_PRESET_ROOT } from '@greeneek/gnk-agent-presets'
import { describe, expect, it } from 'vitest'

/** A row's package name; group and file rows use other forms and are skipped. */
const PRESET_PLUGIN = /^\s*(?:-\s*)?name:\s*'(@greeneek\/[^']+)'/gmu

/** The package a specifier names, dropping any subpath export. */
function packageNameOf(specifier: string): string {
  return specifier.split('/').slice(0, 2).join('/')
}

describe('the Web profile preset closure', () => {
  it('declares every package a shipped preset row can mount', () => {
    const manifests = [
      resolve(import.meta.dirname, '../package.json'),
      resolve(import.meta.dirname, '../../../packages/bundle/base/package.json'),
      resolve(import.meta.dirname, '../../../packages/bundle/web-app/package.json'),
    ]
    const declared = new Set<string>()
    for (const manifestPath of manifests) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dependencies?: Record<string, string>
      }
      for (const name of Object.keys(manifest.dependencies ?? {})) declared.add(name)
    }
    const missing: string[] = []
    for (const id of readdirSync(SHIPPED_PRESET_ROOT)) {
      let source: string
      try {
        source = readFileSync(join(SHIPPED_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
      } catch {
        continue
      }
      for (const match of source.matchAll(PRESET_PLUGIN)) {
        const name = match[1]
        if (name === undefined) continue
        if (!declared.has(packageNameOf(name))) missing.push(`${id}: ${name}`)
      }
    }
    expect(missing).toEqual([])
  })
})
