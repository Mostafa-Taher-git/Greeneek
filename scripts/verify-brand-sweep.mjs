#!/usr/bin/env node
// Portable entry point for the CI brand gate, sharing the .sh wrapper's one
// source of truth: the three rebrand verifiers under scripts/rebrand/. POSIX
// only exposes this gate through a shebang script, which a native Windows
// `cmd`/PowerShell hook cannot execute; hooks and CI call this entry instead.
//
//   node scripts/verify-brand-sweep.mjs
//
// Order is the executed-gates contract (attribution, then residue, then
// egress), and the run stops at the first failing check exactly like
// `scripts/brand-sweep.sh` does.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const VERIFIERS = [
  'scripts/rebrand/verify-attribution.mjs',
  'scripts/rebrand/verify-residue.mjs',
  'scripts/rebrand/verify-egress.mjs',
]

for (const verifier of VERIFIERS) {
  const result = spawnSync(process.execPath, [resolve(root, verifier)], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`brand sweep stopped at ${verifier} (exit ${result.status ?? 'signal'})`)
    process.exit(result.status === null ? 1 : result.status)
  }
}
console.log('brand sweep passed (attribution, residue, egress)')
