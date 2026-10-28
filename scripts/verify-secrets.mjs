#!/usr/bin/env node
// Local staged-mode secret scan. A fast prevention layer beside the commit —
// CI's gitleaks-action push-range scan stays the enforcement lane.
//
//   node scripts/verify-secrets.mjs
//
// Uses gitleaks' documented staged mode (`gitleaks protect --staged`) so only
// the commit being created is scanned. The binary is an environment tool, not
// a workspace dependency: when it is missing the scan reports the absence and
// the installation command instead of failing every commit on a host that has
// not opted in yet — and CI still scans the pushed range.
//
// No local suppression file may exist (no `.gitleaksignore`): a suppression
// path owned by the developer machine could silence a real secret before CI
// sees it. Adding one is a repository decision with a test update, not a
// personal convenience.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The argv after the binary: gitleaks' documented staged mode, redacted so a
 * finding's value never re-enters the terminal or a log.
 * @returns {readonly string[]} the fixed staged-mode argument vector.
 */
export function stagedScanArgs() {
  return ['protect', '--staged', '--redact', '-v', '--no-banner']
}

/**
 * Resolve the gitleaks binary: the explicit `GITLEAKS_BIN` override, then PATH.
 * @param {Readonly<Record<string, string | undefined>>} [env] - process environment consulted for the override.
 * @returns {string} the binary name or path to spawn.
 */
export function selectGitleaksBin(env = process.env) {
  return env.GITLEAKS_BIN ?? 'gitleaks'
}

/**
 * Refuse a local findings-suppression file. A `.gitleaksignore` owned by the
 * developer machine could silence a real secret before CI's push-range scan
 * sees it, so the wrapper treats its existence as a hard failure.
 * @param {string} root - directory the scan runs from.
 * @returns {string | undefined} an explanation when a suppression file exists, else undefined.
 */
export function localSuppressionReason(root) {
  return existsSync(resolve(root, '.gitleaksignore'))
    ? '.gitleaksignore exists; local suppression of findings is not a supported path — delete it and fix the finding'
    : undefined
}

/**
 * Probe whether the gitleaks binary answers `version`.
 * @param {string} bin - binary name or path to probe.
 * @returns {boolean} whether a working binary is present.
 */
function versionProbeSucceeds(bin) {
  const result = spawnSync(bin, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return result.error === undefined && result.status === 0
}

/* CLI entry. Guarded on the module filename so the test lane can import the
   exported helpers without running the scan. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const root = resolve(import.meta.dirname, '..')
  const suppression = localSuppressionReason(root)
  if (suppression !== undefined) {
    console.error(`secrets scan: ${suppression}`)
    process.exit(1)
  }
  const bin = selectGitleaksBin()
  if (!versionProbeSucceeds(bin)) {
    console.log([
      'secrets scan: gitleaks is not installed on this host; the staged scan was skipped.',
      'Install it (https://github.com/gitleaks/gitleaks#installing) or point GITLEAKS_BIN at the binary;',
      'CI scans every pushed range regardless, so this is a prevention layer, not the enforcement lane.',
    ].join('\n'))
    process.exit(0)
  }
  const result = spawnSync(bin, stagedScanArgs(), { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('secrets scan: staged changes contain a detected secret; remove it or, for test fixtures,'
      + ' use an obviously fake value that gitleaks does not flag')
    process.exit(result.status === null ? 1 : result.status)
  }
  console.log('secrets scan: staged changes carry no detected secret')
}
