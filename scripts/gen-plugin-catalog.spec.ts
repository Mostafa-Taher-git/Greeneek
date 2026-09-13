import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify, commandSeamPackages, KINDS } from './gen-plugin-catalog.ts'

const REPO = resolve(import.meta.dirname, '..')

describe('gen-plugin-catalog', () => {
  it('classifies the flagship kinds by convention', () => {
    expect(classify('shell', 'tool-bash')).toEqual(['Tool'])
    expect(classify('skill', 'skill')).toEqual(['Skill'])
    expect(classify('skill', 'tool-skill')).toEqual(['Tool', 'Skill'])
    expect(classify('client', 'ui-model-selection')).toEqual(['Command', 'UI'])
    expect(classify('client', 'ui-commands')).toEqual(['Command', 'UI'])
    expect(classify('llm', 'llm')).toEqual(['LLM'])
    expect(classify('session', 'session')).toEqual(['Capability'])
  })

  it('covers every command-seam marker with the curated set', () => {
    const seam = commandSeamPackages()
    expect(seam.size).toBeGreaterThan(0)
    expect([...seam].sort()).toEqual([
      'client/ui-commands',
      'client/ui-conversation',
      'client/ui-input-trigger',
      'client/ui-model-selection',
      'client/ui-reference',
      'client/ui-skill',
    ])
  })

  it('lists every workspace package in the committed catalog', () => {
    const doc = readFileSync(join(REPO, 'docs', 'plugin-catalog.md'), 'utf8')
    for (const kind of KINDS) {
      expect(doc).toContain(`## ${kind === 'UI' ? 'UI surfaces' : kind === 'LLM' ? 'LLM routes' : kind === 'Capability' ? 'Capabilities' : `${kind}s`}`)
    }
    expect(doc).toContain('22 Tool')
    expect(doc).toContain('253 workspace packages')
  })
})
