/**
 * Gate: the adopted `ds-*` skill pack is complete and loadable by the shipped
 * skill filesystem provider.
 *
 * The owner's v0.3.9 handoff names a closed command inventory. A `SKILL.md`
 * existing on disk is not proof that `/<name>` resolves: the loader ignores a
 * skill whose frontmatter lacks `name`/`description`, whose name fails the
 * kebab-case grammar, or that uses a legacy camelCase invocation key. This gate
 * checks the exact conditions `parseSkillFile` in
 * `packages/skill/skill-filesystem/src/index.ts` uses to accept a file, so a
 * missing or silently-dropped command fails CI instead of disappearing from
 * the session catalog.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@greeneek/cordis'
import { isModelInvocable, isSkillName, isUserInvocable, SkillRegistry } from '@greeneek/gnk-skill'
import * as SkillFileSystem from '@greeneek/gnk-skill-filesystem'

const root = resolve(import.meta.dirname, '..')
const skillsRoot = join(root, '.agents', 'skills')

/** The closed inventory from the owner's handoff. Upstream ships 29 skills, not 28. */
export const DS_SKILL_NAMES = [
  'ds-adopt',
  'ds-best-of-n',
  'ds-blast-radius',
  'ds-blueprint',
  'ds-catchup',
  'ds-context-reset',
  'ds-design',
  'ds-design-audit',
  'ds-explain',
  'ds-help',
  'ds-jury',
  'ds-ledger',
  'ds-lessons',
  'ds-mode',
  'ds-plan-loop',
  'ds-pr',
  'ds-pr-comments',
  'ds-principles',
  'ds-ready',
  'ds-review-loop',
  'ds-revive',
  'ds-sharpen',
  'ds-ship',
  'ds-swarm',
  'ds-tdd',
  'ds-unslop',
  'ds-unstick',
  'ds-verify-loop',
  'ds-watch-pr',
] as const

const LEGACY_INVOCATION_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable']

interface SkillFile {
  frontmatter: string
  body: string
}

function readSkill(name: string): SkillFile {
  const path = join(skillsRoot, name, 'SKILL.md')
  expect(existsSync(path), `${name}: missing SKILL.md`).toBe(true)
  const raw = readFileSync(path, 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  expect(match, `${name}: missing YAML frontmatter`).not.toBeNull()
  return { frontmatter: match?.[1] ?? '', body: match?.[2] ?? '' }
}

function frontmatterString(frontmatter: string, key: string): string | undefined {
  const line = frontmatter.split('\n').find(candidate => candidate.startsWith(`${key}:`))
  if (line === undefined) return undefined
  const value = line.slice(key.length + 1).trim()
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  return value || undefined
}

function installedNames(): string[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('ds-'))
    .map(entry => entry.name)
    .sort()
}

describe('the adopted ds-* skill pack', () => {
  it('installs exactly the owner command inventory', () => {
    expect(installedNames()).toEqual([...DS_SKILL_NAMES].sort())
  })

  it('keeps every upstream description and its /ds-<name> gesture trigger', () => {
    for (const name of DS_SKILL_NAMES) {
      const { frontmatter } = readSkill(name)
      const description = frontmatterString(frontmatter, 'description')
      expect(description, `${name}: missing description`).toBeDefined()
      expect(description?.length ?? 0, `${name}: empty description`).toBeGreaterThan(20)
      expect(description, `${name}: description does not advertise its slash gesture`).toContain(`/${name}`)
    }
  })

  it('uses frontmatter the shipped loader accepts', () => {
    for (const name of DS_SKILL_NAMES) {
      const { frontmatter } = readSkill(name)
      const declared = frontmatterString(frontmatter, 'name')
      expect(declared, `${name}: missing name`).toBe(name)
      expect(isSkillName(declared ?? ''), `${name}: name fails isSkillName`).toBe(true)
      for (const key of LEGACY_INVOCATION_KEYS) {
        expect(frontmatter.includes(`${key}:`), `${name}: legacy invocation key ${key} makes the loader drop it`).toBe(false)
      }
      expect(frontmatter.includes('user-invocable: false'), `${name}: user gesture disabled`).toBe(false)
      expect(frontmatter.includes('disable-model-invocation: true'), `${name}: model invocation disabled`).toBe(false)
    }
  })

  it('appends the Greeneek contract without replacing the upstream body', () => {
    for (const name of DS_SKILL_NAMES) {
      const { body } = readSkill(name)
      expect(body.length, `${name}: empty body`).toBeGreaterThan(200)
      expect(body.split('## Greeneek working contract').length - 1, `${name}: contract missing or duplicated`).toBe(1)
      expect(body.indexOf('## Greeneek working contract'), `${name}: upstream body was replaced`).toBeGreaterThan(200)
      expect(body, `${name}: contract marker missing`).toContain('GREENEEK_API_KEY')
    }
  })

  it('overrides the upstream git and release workflow for this repository', () => {
    const overridden = [
      'ds-pr', 'ds-ship', 'ds-ready', 'ds-revive', 'ds-adopt', 'ds-watch-pr', 'ds-pr-comments',
      'ds-jury', 'ds-best-of-n', 'ds-swarm', 'ds-context-reset', 'ds-ledger', 'ds-verify-loop',
      'ds-tdd', 'ds-blast-radius', 'ds-design', 'ds-design-audit',
    ] as const
    for (const name of overridden) {
      const { body } = readSkill(name)
      expect(body, `${name}: missing Greeneek-specific override`).toContain('## Greeneek-specific override')
    }
    expect(readSkill('ds-ship').body).toContain('Do not create a branch, force-push, merge, tag, or publish')
    expect(readSkill('ds-ready').body).toContain('stops before any push or merge')
  })

  it('ships the watcher script and the upstream attribution the help skill links', () => {
    expect(existsSync(join(skillsRoot, 'ds-watch-pr', 'scripts', 'watch_pr.py'))).toBe(true)
    const provenance = join(skillsRoot, 'ds-help', 'UPSTREAM.md')
    expect(existsSync(provenance), 'ds-help links UPSTREAM.md').toBe(true)
    const text = readFileSync(provenance, 'utf8')
    expect(text).toContain('aicodeking/deepseek-stack')
    expect(text).toContain('MIT')
    expect(readSkill('ds-help').body).toContain('[UPSTREAM.md](UPSTREAM.md)')
  })

  it('is discovered by the real skill filesystem provider from the project root', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gnk-ds-skill-home-'))
    try {
      const ctx = new Context()
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, {
        gnkHome: join(home, '.gnk'),
        agentsHome: join(home, '.agents'),
        watch: false,
      })
      const skills = await ctx.skills.list({ cwd: root })
      const discovered = new Map(skills.map(skill => [skill.name, skill]))
      for (const name of DS_SKILL_NAMES) {
        const skill = discovered.get(name)
        expect(skill, `${name}: the shipped loader does not discover it`).toBeDefined()
        expect(skill?.source, `${name}: unexpected origin`).toBe('project-agents')
        expect(isUserInvocable(skill!), `${name}: /${name} gesture would not resolve`).toBe(true)
        expect(isModelInvocable(skill!), `${name}: model cannot load it`).toBe(true)
      }
      const loaded = await ctx.skills.get('ds-ship', { cwd: root })
      expect(loaded?.content, 'the loaded body carries the Greeneek override').toContain('## Greeneek working contract')
      expect(loaded?.description).toContain('/ds-ship')
    } finally {
      rmSync(home, { recursive: true, force: true })
      await new Promise(resolveDone => setTimeout(resolveDone, 0))
    }
  })
})
