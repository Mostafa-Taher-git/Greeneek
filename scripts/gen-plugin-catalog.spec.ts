import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
    // The scope count is read from the tree, not written down here, so adding
    // or retiring a package cannot stale this assertion.
    const groups = readdirSync(join(REPO, 'packages'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
    const packageCount = groups.reduce((total, group) => {
      const dir = join(REPO, 'packages', group)
      const members = readdirSync(dir, { withFileTypes: true })
      return total + members.filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, 'package.json'))).length
    }, 0)
    expect(packageCount).toBeGreaterThan(0)
    expect(doc).toContain(`${packageCount} workspace packages`)
    expect(doc).toContain('24 Tool')
  })
})
