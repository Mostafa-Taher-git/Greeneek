/** The Maestro Web bundle must carry one parseable Team Client layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@greeneek/cordis-plugin-include'

describe('Agent Teams Web profile bundle', () => {
  it('declares a public opt-in layer containing the Team UI', () => {
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
    expect(manifest.dependencies).toEqual({
      '@greeneek/gnk-client-ui-agent-team': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.gnk!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as { insert?: { id?: string; name?: string }[] }[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([
      { id: 'ui-agent-team', name: '@greeneek/gnk-client-ui-agent-team' },
    ])
  })
})
