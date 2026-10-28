/**
 * Freshness gate over the generated artifacts every catalog-consuming surface
 * depends on. Each listed generator re-derives its committed artifact from
 * source and fails on byte drift; this script runs them in one deterministic
 * order with one actionable report, so a surface edit that forgot its artifact
 * fails here — in pre-push and CI — instead of poisoning an unrelated PR.
 *
 * The check never regenerates: generator input globs are incomplete, running
 * every generator is expensive, and a hook auto-write would race concurrent
 * jobs. A failure names the regeneration command and the artifact paths to
 * stage in the same commit as the source edit ([the catalog-drift issue's
 * contract](../docs/AGENTS.md)).
 * @module scripts/verify-generated-artifacts
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

/** One generated-artifact freshness check. */
interface GeneratedCheck {
  /** Generator module, run with `--check` to compare byte-for-byte. */
  readonly script: string
  /** `pnpm run` script that regenerates the artifact after a source edit. */
  readonly regenerate: string
  /** Paths the generator rewrites; the commit stages these beside its source. */
  readonly artifacts: readonly string[]
  /** Human-readable subject for the report. */
  readonly subject: string
}

/** The freshness checks, in the deterministic order the gate runs them. */
const CHECKS: readonly GeneratedCheck[] = [
  {
    subject: 'the cordis service/event catalog',
    script: 'scripts/gen-cordis-catalog.ts',
    regenerate: 'gen-cordis-catalog',
    artifacts: ['docs/cordis-api', 'packages/extensions/tool-cordis/src/api-catalog.ts'],
  },
  {
    subject: 'the tool catalog',
    script: 'scripts/gen-tool-catalog.ts',
    regenerate: 'gen-tool-catalog',
    artifacts: ['docs/tool-catalog.md'],
  },
  {
    subject: 'the plugin catalog',
    script: 'scripts/gen-plugin-catalog.ts',
    regenerate: 'gen-plugin-catalog',
    artifacts: ['docs/plugin-catalog.md'],
  },
  {
    subject: 'the config catalog',
    script: 'scripts/gen-config-catalog.ts',
    regenerate: 'gen-config-catalog',
    artifacts: ['docs/config-catalog.md'],
  },
  {
    subject: 'the persistence log catalog',
    script: 'scripts/gen-persistence-catalog.ts',
    regenerate: 'gen-persistence-catalog',
    artifacts: ['docs/persistence-catalog.md', 'packages/core/session/src/known-event-types.ts'],
  },
  {
    subject: 'the client slot catalog',
    script: 'scripts/gen-client-catalog.ts',
    regenerate: 'gen-client-catalog',
    artifacts: ['packages/extensions/cordis-client-runner/src/client/slot-catalog.ts'],
  },
]

/** The tsx CLI module path, resolved through the workspace's own devDependency. */
const TSX_CLI = createRequire(import.meta.filename).resolve('tsx/cli')

/**
 * Run one generator's `--check` mode and return its combined output and exit status.
 * @param root - repository root the generator resolves its inputs from.
 * @param check - the check whose generator to run.
 * @returns the exit status plus stdout and stderr of the check run.
 */
function runCheck(root: string, check: GeneratedCheck): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI, resolve(root, check.script), '--check'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Verify every generated artifact is current; exit non-zero naming each stale
 * check's regeneration command and the files to stage.
 * @returns process exit code: 0 when every artifact is fresh, 1 otherwise.
 */
export function verifyGeneratedArtifacts(): number {
  const failures: string[] = []
  for (const check of CHECKS) {
    const { status, stdout, stderr } = runCheck(resolve(import.meta.dirname, '..'), check)
    if (status === 0) continue
    const drift = [stdout.trim(), stderr.trim()].filter(text => text.length > 0).join('\n')
    failures.push([
      `${check.subject} is stale (${check.script} --check exited ${status ?? 'without running'}):`,
      drift,
      `Regenerate with \`pnpm run ${check.regenerate}\`, then stage the source edit together with:`,
      ...check.artifacts.map(path => `  git add ${path}`),
    ].join('\n'))
  }
  if (failures.length > 0) {
    console.error([
      `${failures.length} generated artifact(s) are stale. Regenerate and land them in the same commit as the source change.`,
      '',
      ...failures.flatMap(failure => ['', failure]),
    ].join('\n'))
    return 1
  }
  console.log(`all ${CHECKS.length} generated artifacts are current`)
  return 0
}

/* CLI entry: guarded so importing this module for tests neither runs the gate
   nor calls process.exit. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(verifyGeneratedArtifacts())
}
