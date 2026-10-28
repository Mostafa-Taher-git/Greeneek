#!/usr/bin/env node
// Vercel ignore command for the landing project. Skips the deployment build
// only when the pushed changes cannot affect the landing bundle; every other
// diff builds.
//
//   node vercel-ignore.mjs
//
// Exit 0 means "skip", any other exit builds (Vercel's documented contract).
// The decision fails open: a missing previous SHA (first deployment), a git
// failure, or an unreadable diff all build.
//
// Path scope: git reports repo-relative paths regardless of where this command
// runs, so the landing match accepts both `apps/landing/**` (the project's
// directory in this repository) and a `landing/**` checkout layout, and the
// Vercel project's Root Directory stays `apps/landing` either way.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/** Repo-relative prefixes and files whose change always reaches the bundle. */
const LANDING_PREFIXES = ['apps/landing/', 'landing/']
const ROOT_BUILD_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json']

/**
 * Classify one changed-path list. Pure so the spec can exercise every rule
 * without a git checkout.
 * @param {readonly string[]} changedPaths - repo-relative paths from the diff.
 * @returns {readonly string[]} one reason per matched build rule; empty means skip.
 */
export function landingChangeReasons(changedPaths) {
  const reasons = []
  let sawLandingFile = false
  for (const path of changedPaths) {
    const normalized = path.replaceAll('\\', '/')
    if (!sawLandingFile && LANDING_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
      sawLandingFile = true
      reasons.push('a landing source file changed')
      continue
    }
    if (ROOT_BUILD_FILES.includes(normalized) && !reasons.includes('a root workspace or dependency input changed')) {
      reasons.push('a root workspace or dependency input changed')
    }
  }
  return reasons
}

/**
 * Decide the deployment from the changed paths. Pure; the CLI supplies the git
 * facts.
 * @param {{ previousSha: string | undefined, changedPaths: readonly string[] | undefined }} facts - deployment facts.
 * @returns {{ skip: boolean, reason: string }} whether to skip, and why.
 */
export function decideDeployment({ previousSha, changedPaths }) {
  if (previousSha === undefined || previousSha.length === 0) {
    return { skip: false, reason: 'no previous SHA (first deployment or detached event): build' }
  }
  if (changedPaths === undefined) {
    return { skip: false, reason: 'the changed-path diff is unavailable: build' }
  }
  const reasons = landingChangeReasons(changedPaths)
  if (reasons.length > 0) return { skip: false, reason: reasons.join('; ') }
  return { skip: true, reason: 'no change touches the landing project or its dependency inputs' }
}

/* CLI entry. Guarded on the module filename so the spec can import the pure
   helpers without spawning git. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA
  let changedPaths
  if (previousSha !== undefined && previousSha.length > 0 && commitSha !== undefined && commitSha.length > 0) {
    const diff = spawnSync('git', ['diff', '--name-only', previousSha, commitSha], { encoding: 'utf8' })
    changedPaths = diff.status === 0 ? (diff.stdout ?? '').split('\n').filter(Boolean) : undefined
    if (diff.status !== 0) console.error(`vercel-ignore: git diff failed (${diff.status}); building`)
  }
  const decision = decideDeployment({ previousSha, changedPaths })
  console.log(`vercel-ignore: ${decision.reason}`)
  process.exit(decision.skip ? 0 : 1)
}
