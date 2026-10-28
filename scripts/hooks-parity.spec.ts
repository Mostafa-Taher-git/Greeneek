import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Local/CI hook parity: the brand and secret wrappers that Lefthook and CI run
 * must detect what they claim to detect, and the wiring must use the portable
 * Node entries so native Windows hooks behave like POSIX ones. The banned-term
 * fixture is assembled from pieces so this source itself carries no residue
 * the residue gate would flag.
 */

const root = resolve(import.meta.dirname, '..')

/** The banned brand token, assembled at runtime to keep this source clean. */
const BANNED_TERM = ['Dee', 'pSeek'].join('')

/**
 * Evaluate one expression against the secret wrapper's module in a fresh Node
 * process, the way hooks execute it. Keeps the plain-JavaScript module out of
 * the TypeScript import graph while still testing its real exports. The value
 * travels inside a `v` wrapper so an `undefined` result survives the JSON
 * round trip (it becomes the absent key).
 * @param expression - expression text over the imported `m` namespace.
 * @returns the evaluated value.
 */
function evalSecretModule(expression: string): unknown {
  const moduleUrl = pathToFileURL(resolve(root, 'scripts/verify-secrets.mjs')).toString()
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `const m = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify({ v: ${expression} }))`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) throw new Error(`secret module evaluation failed: ${result.stderr ?? ''}`)
  return (JSON.parse((result.stdout ?? '').trim()) as { v: unknown }).v
}

/**
 * Create a temporary git repository with one committed file and run the real
 * residue verifier against it. The verifier greps its working directory, so a
 * scratch repo owns the corpus and the real allowlist logic runs untouched.
 * @param contents - file text to commit.
 * @returns the verifier's exit status and combined output.
 */
function runResidueVerifier(contents: string): { status: number | null; output: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'gnk-hooks-parity-'))
  try {
    const git = (args: readonly string[]): void => {
      const result = spawnSync('git', ['-c', 'user.email=spec@example.invalid', '-c', 'user.name=spec', ...args], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? ''}`)
    }
    git(['init'])
    writeFileSync(resolve(dir, 'fixture.txt'), contents)
    git(['add', '-A'])
    git(['commit', '-m', 'fixture'])
    const run = spawnSync(process.execPath, [resolve(root, 'scripts/rebrand/verify-residue.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: run.status, output: [run.stdout ?? '', run.stderr ?? ''].join('') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('brand sweep wrapper', () => {
  it('catches a committed banned term outside the allowlist', () => {
    const run = runResidueVerifier(`upstream notes: ${BANNED_TERM} endpoint\n`)
    expect(run.status).toBe(1)
    expect(run.output).toContain('residue outside allowlist')
    expect(run.output).toContain('fixture.txt')
  })

  it('passes a clean scratch tree', () => {
    const run = runResidueVerifier('nothing banned here\n')
    expect(run.status).toBe(0)
    expect(run.output).toContain('no residue outside allowlist')
  })

  it('runs the three verifiers in the executed-gates order from the portable entry', () => {
    const wrapper = readFileSync(resolve(root, 'scripts/verify-brand-sweep.mjs'), 'utf8')
    const attribution = wrapper.indexOf('verify-attribution.mjs')
    const residue = wrapper.indexOf('verify-residue.mjs')
    const egress = wrapper.indexOf('verify-egress.mjs')
    expect(attribution).toBeGreaterThanOrEqual(0)
    expect(residue).toBeGreaterThan(attribution)
    expect(egress).toBeGreaterThan(residue)
  })

  it('is wired through the portable Node entry in Lefthook and CI', () => {
    const lefthook = readFileSync(resolve(root, 'lefthook.yml'), 'utf8')
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
    expect(lefthook).toContain('node scripts/verify-brand-sweep.mjs')
    expect(lefthook).not.toContain('./scripts/brand-sweep.sh')
    expect(ci).toContain('node scripts/verify-brand-sweep.mjs')
    expect(ci).not.toContain('./scripts/brand-sweep.sh')
  })
})

describe('secret scan wrapper', () => {
  it('scans the staged diff in gitleaks\' redacted staged mode', () => {
    expect(evalSecretModule('m.stagedScanArgs()')).toEqual(['protect', '--staged', '--redact', '-v', '--no-banner'])
  })

  it('resolves the binary from GITLEAKS_BIN before PATH', () => {
    expect(evalSecretModule('m.selectGitleaksBin({ GITLEAKS_BIN: \'C:/tools/gitleaks.exe\' })')).toBe('C:/tools/gitleaks.exe')
    expect(evalSecretModule('m.selectGitleaksBin({})')).toBe('gitleaks')
  })

  it('refuses a local findings-suppression file instead of honoring it', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'gnk-hooks-parity-'))
    try {
      expect(evalSecretModule(`m.localSuppressionReason(${JSON.stringify(dir)})`)).toBeUndefined()
      writeFileSync(resolve(dir, '.gitleaksignore'), 'fake-id\n')
      expect(evalSecretModule(`m.localSuppressionReason(${JSON.stringify(dir)})`)).toContain('.gitleaksignore')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs beside the commit in Lefthook while CI keeps the push-range scan', () => {
    const lefthook = readFileSync(resolve(root, 'lefthook.yml'), 'utf8')
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
    expect(lefthook).toContain('node scripts/verify-secrets.mjs')
    // The hook sits in pre-commit, beside the commit it scans.
    const preCommit = lefthook.slice(lefthook.indexOf('pre-commit:'), lefthook.indexOf('pre-merge-commit:'))
    expect(preCommit).toContain('verify-secrets.mjs')
    expect(ci).toContain('gitleaks/gitleaks-action')
  })
})
