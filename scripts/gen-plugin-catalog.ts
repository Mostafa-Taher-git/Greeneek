/**
 * Generate `docs/plugin-catalog.md`: every workspace package in exactly one
 * or more plugin kinds (Tool, Skill, Command, UI, LLM, Capability) so a
 * reader can tell at a glance what each plugin contributes. `--check`
 * verifies the committed artifact. Rationale: the user asked for one
 * categorized plugin list instead of kind knowledge spread across catalogs.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const OUT = join(REPO, 'docs', 'plugin-catalog.md')

/** Kinds, in display order. */
export const KINDS = ['Tool', 'Skill', 'Command', 'UI', 'LLM', 'Capability'] as const
export type PluginKind = (typeof KINDS)[number]

/**
 * Packages contributing client slash/popup commands, with why. Guarded
 * below: every command-seam marker found in source must resolve into this
 * set, so a new command contributor fails generation until it is listed.
 */
const COMMAND_PACKAGES = new Map<string, string>([
  ['client/ui-commands', 'owns ctx.commandUi and the input trigger sources'],
  ['client/ui-input-trigger', 'emits the slash pipeline events the hub adjudicates'],
  ['client/ui-model-selection', 'registers the /model popup command'],
  ['client/ui-conversation', 'owns the slash pipeline hub'],
  ['client/ui-skill', "registers the '/' skill source"],
  ['client/ui-reference', "registers the '@' reference source"],
])

/** Source markers proving a package touches the command seam. */
const COMMAND_MARKERS = ['command.register(', 'inputTriggers.registerSource(', 'slash/input-']

export interface PluginEntry {
  group: string
  dir: string
  name: string
  role: string
  kinds: PluginKind[]
}

/**
 * Classify one package by naming and manifest conventions.
 * @param group - the packages/<group> directory.
 * @param dir - the package directory name.
 * @returns the kinds, never empty (Capability is the fallback).
 */
export function classify(group: string, dir: string): PluginKind[] {
  const kinds: PluginKind[] = []
  if (dir.startsWith('tool-')) kinds.push('Tool')
  if (group === 'skill') kinds.push('Skill')
  if (COMMAND_PACKAGES.has(`${group}/${dir}`)) kinds.push('Command')
  if (dir.startsWith('ui-')) kinds.push('UI')
  if (group === 'llm') kinds.push('LLM')
  if (kinds.length === 0) kinds.push('Capability')
  return kinds
}

function readRole(group: string, dir: string): string {
  const readme = join(REPO, 'packages', group, dir, 'README.md')
  if (!existsSync(readme)) return `Role documented in the ${group} group README.`
  const text = readFileSync(readme, 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)
  const description = (frontmatter?.[1] ?? '').match(/description:\s*"([^"]*)"/)
  const role = (description?.[1] ?? '').trim().replace(/\s+/g, ' ')
  return role === '' ? `Role documented in the ${group} group README.` : role
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * Guard: every command-seam marker in source resolves to a curated package.
 * @returns package keys (group/dir) touching the seam.
 */
export function commandSeamPackages(): Set<string> {
  const hits = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib') continue
        walk(full)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const text = readFileSync(full, 'utf8')
        if (COMMAND_MARKERS.some(marker => text.includes(marker))) {
          const packagesRoot = join(REPO, 'packages')
          const rel = full.slice(packagesRoot.length + 1)
          hits.add(rel.split('/').slice(0, 2).join('/'))
        }
      }
    }
  }
  walk(join(REPO, 'packages'))
  return hits
}

function collect(): PluginEntry[] {
  const seam = commandSeamPackages()
  for (const hit of seam) {
    if (!COMMAND_PACKAGES.has(hit)) {
      throw new Error(
        `gen-plugin-catalog: ${hit} touches the command seam but is not in COMMAND_PACKAGES — list it with a why-comment.`,
      )
    }
  }
  const entries: PluginEntry[] = []
  for (const group of readdirSync(join(REPO, 'packages')).sort()) {
    const groupDir = join(REPO, 'packages', group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const dir of readdirSync(groupDir).sort()) {
      const manifestPath = join(groupDir, dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string
        gnk?: { client?: unknown }
      }
      entries.push({
        group,
        dir,
        name: manifest.name ?? `@greeneek/gnk-${dir}`,
        role: readRole(group, dir),
        kinds: classify(group, dir),
      })
    }
  }
  return entries
}

function section(kind: PluginKind, rows: PluginEntry[]): string {
  const title = kind === 'UI' ? 'UI surfaces' : kind === 'LLM' ? 'LLM routes' : kind === 'Capability' ? 'Capabilities' : `${kind}s`
  const lines = [`## ${title}`, '']
  if (kind === 'Capability') {
    const families = new Map<string, PluginEntry[]>()
    for (const row of rows) {
      const list = families.get(row.group) ?? []
      list.push(row)
      families.set(row.group, list)
    }
    for (const [family, members] of [...families.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`### \`${family}/\``, '')
      lines.push('| Package | Role |')
      lines.push('| --- | --- |')
      for (const member of members) lines.push(`| \`${member.name}\` | ${cell(member.role)} |`)
      lines.push('')
    }
    return lines.join('\n')
  }
  lines.push('| Package | Role |')
  lines.push('| --- | --- |')
  for (const row of rows) lines.push(`| \`${row.name}\` | ${cell(row.role)} |`)
  lines.push('')
  return lines.join('\n')
}

function generate(entries: PluginEntry[]): string {
  const counts = KINDS.map(kind => `${entries.filter(e => e.kinds.includes(kind)).length} ${kind}`)
  const parts = [
    '<!-- Generated by scripts/gen-plugin-catalog.ts — do not edit by hand.',
    '     Run `pnpm run gen-plugin-catalog` to regenerate. -->',
    '',
    '# Plugin Catalog',
    '',
    'Every workspace package (`packages/<family>/<name>`), categorized by what it contributes, so it is easy to tell a Tool from a Skill from a Command and everything else. Kinds follow naming and manifest conventions, checked by the generator — see the legend. Deeper references per kind: the generated Tool Schema Catalog (`docs/tool-catalog.md`) for tool schemas, each `packages/<family>/README.md` group map for family roles, and each package README for the full contract.',
    '',
    '## Legend',
    '',
    '| Kind | What it is | How the generator detects it |',
    '| --- | --- | --- |',
    '| Tool | Model-facing tools on `ctx.tools` | directory starts with `tool-` (same scope as the tool catalog) |',
    '| Skill | Skill registry, providers, and consumer on `ctx.skills` | `packages/skill/*` |',
    '| Command | Client slash/popup commands (`ctx.commandUi`, input trigger sources) | curated set, guarded: every command-seam marker in source must resolve into it |',
    '| UI | Browser surfaces | directory starts with `ui-` |',
    '| LLM | Model routes and provider adapters | `packages/llm/*` |',
    '| Capability | Every other plugin, grouped by family directory | fallback: anything unmatched |',
    '',
    `Scope: ${entries.length} workspace packages; every package appears under each of its kinds (${counts.join(', ')} rows). A package with several kinds (e.g. a tool that also contributes a command) appears in each section.`,
    '',
  ]
  for (const kind of KINDS) {
    parts.push(section(kind, entries.filter(e => e.kinds.includes(kind))))
  }
  return parts.join('\n')
}

function main(): void {
  const check = process.argv.includes('--check')
  const entries = collect()
  const output = generate(entries)
  if (check) {
    const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (committed !== output) {
      console.error('gen-plugin-catalog: docs/plugin-catalog.md is stale — run `pnpm run gen-plugin-catalog`.')
      process.exit(1)
    }
    console.log(`gen-plugin-catalog: fresh (${entries.length} packages).`)
    return
  }
  writeFileSync(OUT, output)
  console.log(`gen-plugin-catalog: wrote docs/plugin-catalog.md (${entries.length} packages).`)
}

main()
