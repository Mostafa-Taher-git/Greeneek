import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * Scope note: this spec covers only the CI this repository operates —
 * `.github/workflows/ci.yml`, `.gitlab-ci.yml`, `lefthook.yml`, and the
 * scripts they invoke. The larger GitHub fleet (ci-master, Windows/Wine
 * drills, E2B/e2e suites, release and Pages workflows, issue bots) never
 * existed in this repo's history, so no test here may reference it.
 */

const root = resolve(import.meta.dirname, '..')

/** Every action pin in one workflow file carries the current major. */
function assertWorkflowActionsPinned(path: string): void {
  for (const use of rawActionUses(path)) assertCurrentActionMajor(use)
}

describe('CI workflow', () => {
  const workflow = loadWorkflow('.github/workflows/ci.yml')

  it('pins every action to a full commit SHA on a Node 24 major', () => {
    assertWorkflowActionsPinned('.github/workflows/ci.yml')
  })

  it('does not pin pnpm twice', () => {
    for (const step of allSteps(workflow)) {
      if (typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@')) expect(step.with).toBeUndefined()
    }
  })

  it('verifies generated artifacts and the landing build', () => {
    const runs = allSteps(workflow)
      .map(step => step.run)
      .filter((run): run is string => typeof run === 'string')
      .join('\n')

    expect(runs).toContain('pnpm run verify-generated-artifacts')
    expect(runs).toContain('pnpm --filter @greeneek/landing run typecheck')
    expect(runs).toContain('pnpm --filter @greeneek/landing run build')
  })

  it('keeps the Wine Host TypeScript compile the repository heap budget', () => {
    const wineGates = readFileSync(resolve(root, 'scripts/wine-windows-gates.sh'), 'utf8')

    expect(wineGates).toContain(
      'wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=4096 "$tsc_js" -b tsconfig.host.json --pretty false',
    )
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })

  it('runs the pwsh terminal lane on a native Windows runner', () => {
    const lane = jobNamed(workflow, 'windows-shell')

    expect(lane['runs-on']).toBe('windows-latest')
    const runs = jobSteps(workflow, 'windows-shell')
      .map(step => (typeof step.run === 'string' ? step.run : ''))
      .filter(run => run.length > 0)
    expect(runs.some(run => run.includes('pnpm exec vitest run packages/terminal/terminal-bash'))).toBe(true)
  })

  it('runs the release-verification layers in a parallel repository job', () => {
    const lane = jobNamed(workflow, 'repository')

    expect(lane['runs-on']).toBe('ubuntu-latest')
    // The gate waits 1800s for the whole workflow run, so the job bounds
    // itself at the same ceiling: a hang surfaces as a failed run inside the
    // wait instead of the gate expiring first.
    expect(lane['timeout-minutes']).toBe(30)
    const steps = jobSteps(workflow, 'repository')
    const runs = steps.map(step => (typeof step.run === 'string' ? step.run : ''))
    expect(runs.some(run => run.includes('pnpm run duplication'))).toBe(true)
    // Replay stays read-only: CI never writes committed snapshot outputs.
    const snapshot = steps.find(step => typeof step.run === 'string' && step.run.includes('pnpm run test:snapshot'))
    expect(snapshot?.env).toMatchObject({ GNK_SNAPSHOT: 'replay' })
    // Headless and Web profiles resolve `@greeneek/gnk-*/typert` through package
    // exports into built `lib/typert.host.js`, so the build precedes replay;
    // hygiene follows the build so the built-invariants gate sees artifacts.
    const build = runs.findIndex(run => run.trim() === 'pnpm build')
    expect(build).toBeLessThan(runs.findIndex(run => run.includes('pnpm run test:snapshot')))
    expect(runs.findIndex(run => run.includes('pnpm run hygiene'))).toBeGreaterThan(build)
  })

  it('runs the consumer verification matrix in its own bounded job', () => {
    const lane = jobNamed(workflow, 'consumers')

    expect(lane['runs-on']).toBe('ubuntu-latest')
    // The job builds once and then runs each lane as its own step; 45 minutes
    // covers a cold runner with room to fail instead of hanging.
    expect(lane['timeout-minutes']).toBe(45)
    const steps = jobSteps(workflow, 'consumers')
    const runs = steps.map(step => (typeof step.run === 'string' ? step.run : ''))
    // The build must precede every lane that reads built lib/.
    const build = runs.indexOf('pnpm build')
    expect(build).toBeGreaterThanOrEqual(0)
    for (const command of [
      'pnpm run test:expected',
      'pnpm run test:web:built',
      'pnpm run doc-typecheck:contracts-ready',
    ]) {
      expect(runs.indexOf(command)).toBeGreaterThan(build)
    }
    // Replay stays read-only: the lane compares committed outputs.
    for (const command of ['pnpm run test:expected', 'pnpm run test:web:built']) {
      const step = steps.find(candidate => candidate.run === command)
      expect(step?.env).toMatchObject({ GNK_SNAPSHOT: 'replay', CI: true })
    }
  })
})

describe('Desktop release workflow', () => {
  const workflow = loadWorkflow('.github/workflows/release-desktop.yml')

  it('offers a dry-run dispatch that cannot publish', () => {
    if (!isRecord(workflow.on)) throw new TypeError('release workflow must define triggers')
    const dispatch = workflow.on.workflow_dispatch
    if (!isRecord(dispatch) || !isRecord(dispatch.inputs) || !isRecord(dispatch.inputs.dry_run)) {
      throw new TypeError('release workflow must define the dry_run dispatch input')
    }

    expect(dispatch.inputs.tag).toMatchObject({ required: true, type: 'string' })
    expect(dispatch.inputs.dry_run).toMatchObject({ required: false, default: false, type: 'boolean' })
    expect(jobNamed(workflow, 'publish').if).toBe('${{ inputs.dry_run != true }}')
  })

  it('gates on a successful complete CI workflow run', () => {
    const gate = runText(jobNamed(workflow, 'gate'))

    expect(gate).toContain('actions/workflows/ci.yml/runs')
    expect(gate).toContain('.event == "push"')
    expect(gate).toContain('.status == "completed"')
    expect(gate).toContain('.conclusion == "success"')
    expect(gate).toContain('no successful push CI workflow run')
  })

  it('pins every action to a full commit SHA on a Node 24 major', () => {
    assertWorkflowActionsPinned('.github/workflows/release-desktop.yml')
  })

  it('does not pin pnpm twice', () => {
    for (const step of allSteps(workflow)) {
      if (typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@')) expect(step.with).toBeUndefined()
    }
  })

  it('serves native pwsh in every Windows shell step', () => {
    for (const step of jobSteps(workflow, 'windows')) {
      if (step.shell !== undefined) expect(step.shell).toBe('pwsh')
    }
    expect(runText(jobNamed(workflow, 'windows'))).not.toMatch(/\bshell:\s*bash\b/)
  })

  it('boots the unpacked tree on both platforms before assembling the release', () => {
    expect(runText(jobNamed(workflow, 'linux'))).toContain('dist/linux-unpacked/resources/app')
    expect(runText(jobNamed(workflow, 'windows'))).toContain('dist/win-unpacked/resources/app')
  })

  it('prepares stable aliases once per platform with the resolved tag', () => {
    for (const name of ['linux', 'windows']) {
      const runs = jobSteps(workflow, name)
        .map(step => step.run)
        .filter((run): run is string => typeof run === 'string' && run.includes('prepare-release-assets.mjs'))

      expect(runs).toHaveLength(1)
      expect(runs[0]).toContain('--tag "${{ needs.gate.outputs.ref }}"')
    }
  })

  it('writes and re-verifies checksums and the release manifest', () => {
    const assemble = runText(jobNamed(workflow, 'assemble'))
    expect(assemble).toContain('release-manifest.mjs --root release-assets')
    expect(assemble).toContain('release-manifest.mjs --root release-assets --verify')

    const publish = runText(jobNamed(workflow, 'publish'))
    expect(publish).toContain('release-manifest.mjs --root release-assets --verify')
  })
})

describe('Python release workflows', () => {
  it('uses the shared macOS deployment-target check in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    const runtimeScript: unknown[] = runtimeWheel.script
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('PLATFORM" = macos-arm64'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('"$EXE" "$EXE-spawn-helper"')
  })

  it('builds and black-box tests the Windows x64 wheel in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const windows = workflow['runtime-windows-x64']
    const publish = workflow['publish-python']
    if (!isRecord(windows) || !Array.isArray(windows.before_script) || !Array.isArray(windows.script)
      || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the Windows runtime and aggregate publication jobs')
    }

    expect(windows.tags).toEqual(['windows-x64'])
    expect(windows.variables).toMatchObject({ PKG_TARGET: 'node24-win-x64', PLATFORM: 'win-x64' })
    expect(JSON.stringify(windows.before_script)).toContain('.ci-python\\\\Scripts')
    expect(JSON.stringify(windows.before_script)).toContain('[IO.Path]::PathSeparator')
    expect(JSON.stringify(windows.script)).toContain('win_amd64.whl')
    expect(JSON.stringify(windows.script)).toContain('--scenario all --installed-wheel')
    expect(publish.needs).toContainEqual({ job: 'runtime-windows-x64', artifacts: true })
  })
})

describe('Git hooks', () => {
  it('carries no translation-pairing hook after the bilingual retirement', () => {
    const lefthook = loadWorkflow('lefthook.yml')

    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toBeUndefined()
    }
  })
})

describe('Dependency automation', () => {
  const config = loadWorkflow('.github/dependabot.yml')
  const updates = (): Record<string, unknown>[] => {
    if (!Array.isArray(config.updates)) throw new TypeError('dependabot.yml must define updates')
    return config.updates.map((update, index) => {
      if (!isRecord(update)) throw new TypeError(`dependabot update ${index} must be a mapping`)
      return update
    })
  }

  function groupsFor(ecosystem: string): Record<string, unknown> {
    const update = updates().find(candidate => candidate['package-ecosystem'] === ecosystem)
    if (!isRecord(update?.groups)) throw new TypeError(`${ecosystem} must define update groups`)
    return update.groups
  }

  it('groups families that only stay green when they move together', () => {
    const groups = groupsFor('npm')

    expect(groups.lexical).toMatchObject({ patterns: ['lexical', '@lexical/*'] })
    expect(groups.tailwind).toMatchObject({ patterns: ['tailwindcss', '@tailwindcss/*'] })
    expect(groups.opentelemetry).toMatchObject({ patterns: ['@opentelemetry/*'] })
    expect(groups.vite).toMatchObject({ patterns: ['vite', '@vitejs/*', 'vitest', '@vitest/*'] })
    expect(groups.electron).toMatchObject({
      patterns: ['electron', 'electron-builder', 'electron-log', 'electron-updater', '@electron/*'],
    })
    expect(groups['pi-ai']).toMatchObject({ patterns: ['@earendil-works/*'] })
  })

  it('groups GitHub Actions so workflow majors cannot mix', () => {
    expect(groupsFor('github-actions').actions).toMatchObject({ patterns: ['*'] })
  })

  it('uses repository labels on every update', () => {
    const valid = new Set(['dependencies', 'build'])
    for (const update of updates()) {
      if (!Array.isArray(update.labels)) throw new TypeError('every dependabot update must declare labels')
      for (const label of update.labels) expect(valid.has(String(label))).toBe(true)
    }
  })
})

const CURRENT_ACTION_MAJORS: Record<string, string> = {
  'actions/checkout': 'v7',
  'actions/setup-node': 'v7',
  'pnpm/action-setup': 'v6',
  'actions/upload-artifact': 'v7',
  'actions/download-artifact': 'v8',
  'gitleaks/gitleaks-action': 'v3',
  'softprops/action-gh-release': 'v3',
}

function assertCurrentActionMajor(use: string): void {
  if (use.startsWith('./') || use.startsWith('docker://')) return
  const pin = use.match(/^(\S+)@([0-9a-f]{40})\s*#\s*(v\S+)$/)
  if (pin === null) {
    throw new Error(`"${use}" must pin a full commit SHA with a "# vN" version comment`)
  }
  const expected = CURRENT_ACTION_MAJORS[pin[1] ?? '']
  if (expected !== undefined && pin[3] !== expected) {
    throw new Error(`${pin[1]} must use ${expected}, found ${pin[3]}`)
  }
}

/**
 * Every `uses:` line of one workflow, as raw file text. The pinned SHA check
 * reads this form because YAML strips a trailing `# vN` comment from the
 * parsed value while Dependabot and reviewers need the comment in the file.
 * @param path - workflow file path relative to the repository root.
 * @returns each `uses:` value as written, trimmed.
 */
function rawActionUses(path: string): readonly string[] {
  return readFileSync(resolve(root, path), 'utf8').split('\n').flatMap((line) => {
    const match = line.match(/^\s*-?\s*uses:\s*(\S.*)$/)
    return match === null || match[1] === undefined ? [] : [match[1].trim()]
  })
}

function workflowJobs(workflow: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(workflow.jobs)) throw new TypeError('workflow must define jobs')
  return workflow.jobs
}

function jobNamed(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
  const job = workflowJobs(workflow)[name]
  if (!isRecord(job)) throw new TypeError(`workflow must define the ${name} job`)
  return job
}

function jobSteps(workflow: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const steps = jobNamed(workflow, name).steps
  if (!Array.isArray(steps)) throw new TypeError(`${name} must define steps`)
  return steps.map((step, index) => {
    if (!isRecord(step)) throw new TypeError(`${name} step ${index} must be a mapping`)
    return step
  })
}

function allSteps(workflow: Record<string, unknown>): Record<string, unknown>[] {
  return Object.keys(workflowJobs(workflow)).flatMap((name) => {
    const job = workflowJobs(workflow)[name]
    return isRecord(job) && Array.isArray(job.steps) ? job.steps.filter(isRecord) : []
  })
}

function runText(job: Record<string, unknown>): string {
  if (!Array.isArray(job.steps)) return ''
  return job.steps
    .filter(isRecord)
    .map(step => (typeof step.run === 'string' ? step.run : ''))
    .join('\n')
}

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
