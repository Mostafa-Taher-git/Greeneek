/**
 * Enforce `wc -w`-style ceilings and target ratchets from
 * `scripts/doc-budgets.manifest.json`. Missing files and invalid budgets fail;
 * `--list` reports current usage. Only listed standing docs are budgeted.
 * Entries may be a single ceiling number or `{ target, ceiling }` where
 * `target` is the intended size and `ceiling` is the temporary maximum. At or
 * below target a document must retain at least 5% headroom; above target the
 * ceiling is frozen until relocation or condensation brings the document under
 * target. Raising a ceiling requires the justification defined in
 * `docs/AGENTS.md`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const MANIFEST_PATH = resolve(root, 'scripts/doc-budgets.manifest.json')

/** `wc -w` equivalent: count whitespace-delimited tokens. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

type BudgetEntry = number | { target: number; ceiling: number }

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, BudgetEntry>

const listOnly = process.argv.includes('--list')
const failures: string[] = []
const rows: string[] = []

function isValidBudget(entry: unknown): entry is { target: number; ceiling: number } {
  return typeof entry === 'object' && entry !== null
    && Number.isInteger((entry as { target?: unknown }).target)
    && Number.isInteger((entry as { ceiling?: unknown }).ceiling)
    && (entry as { target: number }).target > 0
    && (entry as { ceiling: number }).ceiling >= (entry as { target: number }).target
}

for (const [path, entry] of Object.entries(manifest)) {
  const normalized: { target: number | null; ceiling: number } | null = typeof entry === 'number'
    ? Number.isInteger(entry) && entry > 0 ? { target: null, ceiling: entry } : null
    : isValidBudget(entry)
      ? { target: entry.target, ceiling: entry.ceiling }
      : null
  if (normalized === null) {
    rows.push(`BAD   ${'—'.padStart(6)} / ${'—'.padEnd(6)} ${path}`)
    failures.push(`${path}: budget must be a positive integer ceiling or { target, ceiling } with 0 < target <= ceiling, got ${JSON.stringify(entry)}`)
    continue
  }
  const { target, ceiling } = normalized
  const abs = resolve(root, path)
  if (!existsSync(abs)) {
    rows.push(`MISS  ${'—'.padStart(6)} / ${String(ceiling).padEnd(6)} ${path}`)
    failures.push(`${path}: budgeted file does not exist (renamed or deleted? update scripts/doc-budgets.manifest.json in the same change)`)
    continue
  }
  const words = countWords(readFileSync(abs, 'utf8'))
  const overCeiling = words > ceiling
  const overTarget = target !== null && words > target
  const headroomViolation = target !== null && !overTarget && words > target * 0.95
  const headroomLimit = target !== null ? Math.floor(target * 0.95) : 0
  rows.push(`${overCeiling || overTarget || headroomViolation ? 'OVER' : 'ok  '}  ${String(words).padStart(6)} / ${String(ceiling).padEnd(6)} ${path}${target !== null ? ` (target ${target})` : ''}`)
  if (overCeiling) {
    failures.push(`${path}: ${words} words exceeds the ${ceiling}-word ceiling — relocate or condense per docs/AGENTS.md (raising the ceiling requires justification in the PR)`)
  }
  if (overTarget) {
    failures.push(`${path}: ${words} words exceeds the ${target}-word target — ceiling ${ceiling} is frozen until relocation or condensation brings the document under target (docs/AGENTS.md)`)
  } else if (headroomViolation) {
    failures.push(`${path}: ${words} words retains less than 5% headroom under the ${target}-word target (limit ${headroomLimit} words) — condense to restore headroom`)
  }
}

if (listOnly) {
  console.log(rows.join('\n'))
  process.exit(0)
}

if (failures.length > 0) {
  console.error('verify-doc-budgets failed:\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('\nSee docs/AGENTS.md for the documentation standard and the relocation-first rule.')
  process.exit(1)
}

console.log(`verify-doc-budgets: ${Object.keys(manifest).length} budgeted docs within ceiling.`)
