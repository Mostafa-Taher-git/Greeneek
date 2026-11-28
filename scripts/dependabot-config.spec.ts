/** Pins for the Dependabot configuration that keeps lockstep families together. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

const root = resolve(import.meta.dirname, '..')

describe('Dependabot configuration', () => {
  const source = readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8')
  const config = yaml.load(source) as {
    version: number
    updates: readonly Record<string, unknown>[]
  }

  it('declares version 2 and validates as an object with updates', () => {
    expect(config.version).toBe(2)
    expect(Array.isArray(config.updates)).toBe(true)
    expect(config.updates.length).toBeGreaterThan(0)
  })

  it('keeps npm and uv ecosystems with explicit schedules', () => {
    const ecosystems = config.updates.map(entry => entry['package-ecosystem'])
    expect(ecosystems).toContain('npm')
    expect(ecosystems).toContain('uv')
    for (const entry of config.updates) {
      expect(entry.schedule).toMatchObject({ interval: 'cron' })
      expect(entry.labels).toContain('dependencies')
      expect(entry.labels).toContain('build')
    }
  })

  it('groups the lockstep dependency families', () => {
    const npm = config.updates.find(entry => entry['package-ecosystem'] === 'npm')
    if (npm === undefined) throw new TypeError('npm ecosystem is missing')
    const groups = npm.groups as Record<string, { patterns: readonly string[] }>
    for (const family of ['lexical', 'tailwind', 'opentelemetry', 'vite', 'electron', 'pi-ai']) {
      expect(groups[family]?.patterns?.length, family).toBeGreaterThan(0)
    }
  })

  it('never asks Dependabot to update vendored sources', () => {
    expect(source).toContain('"vendor/**"')
  })
})
