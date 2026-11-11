/**
 * Refuse local investigation scratch at commit time. The repository root is
 * where a session drops probe scripts, CI JSON dumps, and multi-megabyte
 * coverage text; none of it may reach a commit, and a manual `git add -A` is
 * exactly the gesture that would carry it. This runs on the staged set, so a
 * file that never gets staged costs nothing.
 *
 * A root-level dotfile is the signal. Legitimate dotfiles are the short
 * allowlist below; anything else must move under `.artifacts/`, which is
 * ignored, or be deleted. `.recore/` and `scripts/scratch-*` are named
 * separately because they are the two scratch locations a workflow writes
 * outside the root.
 *
 * @module scripts/verify-no-local-scratch
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Repository-root dotfiles that are project configuration, not scratch. */
export const ROOT_DOTFILE_ALLOWLIST: ReadonlySet<string> = new Set([
  '.dependency-cruiser.json',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gitlab-ci.yml',
  '.gitleaks.toml',
  '.jscpd.json',
  '.npmrc',
  '.oxlintrc.json',
  '.oxlintrc.staged.json',
  '.pnpmrc',
  '.rgignore',
])

/** Directories and prefixes that hold workflow scratch rather than sources. */
const SCRATCH_PREFIXES: readonly string[] = ['.recore/', 'scripts/scratch-']

/**
 * Whether one repository-relative path is local scratch.
 * @param path - a path as `git` reports it, with forward slashes.
 * @returns whether the path must not be committed.
 */
export function isLocalScratch(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  if (SCRATCH_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true
  if (normalized.includes('/')) return false
  return normalized.startsWith('.') && !ROOT_DOTFILE_ALLOWLIST.has(normalized)
}

/**
 * Read the staged paths that a commit would record.
 * @param cwd - repository root the `git` invocation runs in.
 * @returns added, copied, modified, and renamed paths, relative to `cwd`.
 */
export function stagedPaths(cwd: string): string[] {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd,
    encoding: 'utf8',
  })
  return output.split('\n').filter(path => path.length > 0)
}

/** Report every staged scratch path and fail the commit. */
function main(): void {
  const offenders = stagedPaths(process.cwd()).filter(isLocalScratch)
  if (offenders.length === 0) return
  console.error('refusing to commit local scratch:')
  for (const path of offenders) console.error(`  ${path}`)
  console.error('Delete these files, or move durable output under .artifacts/ (ignored by Git).')
  process.exitCode = 1
}

/* v8 ignore next 3 -- executed only as a command, never when a spec imports the helpers. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
