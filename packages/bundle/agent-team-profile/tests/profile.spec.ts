/** The Maestro profile bundle must carry one parseable, explicit Team layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@greeneek/cordis-plugin-include'

describe('Agent Teams profile bundle', () => {
  it('declares a public opt-in layer with Team-owned controls', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: unknown
      dependencies?: Record<string, string>
      gnk?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig).toEqual({ access: 'public' })
    expect(manifest.gnk?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@greeneek/gnk-agent-team': 'workspace:^',
      '@greeneek/gnk-tool-agent-team': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.gnk!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      disabled?: boolean
      config?: Record<string, unknown>
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    expect(patches.find(patch => patch.id === 'tool-subagent-control')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'tool-subagent-list-agents')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'tool-subagent')?.config).toMatchObject({ backgroundMode: 'one-shot' })
    expect(patches.find(patch => patch.id === 'tool-subagent-fork')?.config).toMatchObject({ backgroundMode: 'one-shot' })
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'agent-team')).toMatchObject({
      name: '@greeneek/gnk-agent-team',
      config: { maxMembers: 8 },
    })
    expect(inserted.find(entry => entry.id === 'tool-agent-team')).toMatchObject({
      name: '@greeneek/gnk-tool-agent-team',
      config: { freshProvider: 'spawn', forkProvider: 'fork' },
    })
  })
})
