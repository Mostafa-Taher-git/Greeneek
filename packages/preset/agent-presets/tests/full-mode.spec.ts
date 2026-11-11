/**
 * FULL-mode persona-contract fixtures (S5-10a/S5-10b).
 *
 * These pin the shipped presets' model-visible promises: every owner-named
 * flow must be routed through the Craft gateway, and every unavailable-app
 * path must degrade honestly. If a preset regresses to a single flagship
 * flow or a preview stub, the matching assertion fails.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHIPPED_PRESET_ROOT } from '@greeneek/gnk-agent-presets'
import * as yaml from 'js-yaml'

/** One parsed preset composition entry. */
interface Entry {
  readonly id?: unknown
  readonly name?: unknown
  readonly config?: unknown
}

/** Read every entry of one shipped preset, flattened through nested groups. */
async function entries(id: string): Promise<Entry[]> {
  const source = await readFile(join(SHIPPED_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
  const parsed: unknown = yaml.load(source)
  if (!Array.isArray(parsed)) throw new TypeError(`${id} preset must contain a Cordis entry list`)
  const flat: Entry[] = []
  const walk = (list: readonly unknown[]): void => {
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const entry = item as Entry
      flat.push(entry)
      if (Array.isArray(entry.config)) walk(entry.config)
    }
  }
  walk(parsed)
  return flat
}

/** The persona text of one shipped preset. */
async function personaText(id: string): Promise<string> {
  const entry = (await entries(id)).find(candidate => candidate.id === 'persona')
  if (typeof entry?.config !== 'object' || entry.config === null || !('text' in entry.config)) {
    throw new TypeError(`${id} preset must configure a persona text`)
  }
  return String(entry.config.text)
}

/** The raw composition text of one shipped preset. */
async function compositionText(id: string): Promise<string> {
  return await readFile(join(SHIPPED_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
}

describe('pixels-designer is a full-mode preset', () => {
  it('routes photo batch, layout, and the remaining design flows through the gateway', async () => {
    const persona = await personaText('pixels-designer')

    expect(persona).toContain('craft_list_apps')
    expect(persona).toContain('craft_open_app')
    expect(persona).toContain('Photo batch')
    expect(persona).toContain('cull')
    expect(persona).toContain('contact sheet')
    expect(persona).toContain('Poster and page layout')
    expect(persona).toContain('Vector illustration')
    expect(persona).toContain('Video editing and color grading')
    expect(persona).toContain('motion graphics')
    expect(persona).toContain('Audio editing and mixing')
    expect(persona).toContain('Image editing and drafting')
  })

  it('degrades honestly when a dedicated app is not measured ready', async () => {
    const persona = await personaText('pixels-designer')

    expect(persona).toContain('not-installed')
    expect(persona).toContain('app-installed-cli-missing')
    expect(persona).toContain('never claim an app ran')
    expect(persona).toContain('name the missing app')
    expect(persona).toContain('never substitute a silent fallback')
  })

  it('composes the gateway, workspace files, planning, and research tools', async () => {
    const ids = (await entries('pixels-designer')).map(entry => entry.id)

    expect(ids).toContain('craft-service')
    expect(ids).toContain('craft-local')
    expect(ids).toContain('tool-craft')
    expect(ids).toContain('tool-fs')
    expect(ids).toContain('tool-fs-search')
    expect(ids).toContain('plan-mode')
    expect(ids).toContain('tool-ask-user')
    expect(ids).toContain('tool-todo')
    expect(ids).toContain('tool-web')
  })
})

describe('instructor is a full-mode preset', () => {
  it('routes roadmaps, tutorials, research, and the CV pipeline', async () => {
    const persona = await personaText('instructor')

    expect(persona).toContain('Roadmaps')
    expect(persona).toContain('Tutorials with explanations')
    expect(persona).toContain('Research flow')
    expect(persona).toContain('web_search')
    expect(persona).toContain('web_fetch')
    expect(persona).toContain('Complete CV creation')
    expect(persona).toContain('CV review and edit')
  })

  it('holds the review gate and the anti-fabrication rule in the persona', async () => {
    const persona = await personaText('instructor')

    expect(persona).toContain('explicit sign-off')
    expect(persona).toContain('A rejected review returns to revision and cannot export')
    expect(persona).toContain('Anti-fabrication rule')
    expect(persona).toContain('never fill the gap yourself')
    expect(persona).toContain('never claims a PDF exists')
    expect(persona).toContain('traceable markdown')
  })

  it('composes the gateway, workspace files, and research tools', async () => {
    const ids = (await entries('instructor')).map(entry => entry.id)

    expect(ids).toContain('craft-service')
    expect(ids).toContain('craft-local')
    expect(ids).toContain('tool-craft')
    expect(ids).toContain('tool-fs')
    expect(ids).toContain('tool-fs-search')
    expect(ids).toContain('tool-ask-user')
    expect(ids).toContain('tool-todo')
    expect(ids).toContain('tool-web')
  })
})

describe('both full-mode presets stay honest about the remaining suite', () => {
  it('carries no preview-stub flagship wording', async () => {
    for (const id of ['pixels-designer', 'instructor']) {
      const text = await compositionText(id)
      expect(text).not.toContain('flagship flow is')
      expect(text).not.toContain('Preview stance')
    }
  })

  it('documents every Craft app as gateway-discovered, never hand-wired', async () => {
    for (const id of ['pixels-designer', 'instructor']) {
      expect(await compositionText(id)).toContain('craft_list_apps')
    }
  })
})
