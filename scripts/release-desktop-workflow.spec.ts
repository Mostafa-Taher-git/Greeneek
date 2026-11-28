/** Structural pins for the desktop release workflow's tag and platform gates. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
import { describe, expect, it } from 'vitest'
import {
  assertWorkflowActionsPinned,
  isRecord,
  jobNamed,
  jobSteps,
  loadWorkflow,
  runText,
} from './lib/workflow-assertions.ts'

describe('desktop release workflow', () => {
  const path = '.github/workflows/release-desktop.yml'
  const workflow = loadWorkflow(path)
  const source = readFileSync(resolve(root, path), 'utf8')

  it('pins every action to a full commit SHA on a Node 24 major', () => {
    assertWorkflowActionsPinned(path)
  })

  it('validates the release tag instead of accepting a branch name', () => {
    if (!isRecord(workflow.on)) throw new TypeError('release workflow must define triggers')
    const dispatch = workflow.on.workflow_dispatch
    if (!isRecord(dispatch) || !isRecord(dispatch.inputs) || !isRecord(dispatch.inputs.tag)) {
      throw new TypeError('desktop release dispatch requires a tag input')
    }
    expect(dispatch.inputs.tag.required).toBe(true)
    expect(runText(jobNamed(workflow, 'gate'))).toContain('not a desktop release tag')
    expect(source).toContain('ref: ${{ inputs.tag || github.ref }}')
    expect(source).toContain('REQUESTED_REF: ${{ inputs.tag || github.ref_name }}')
  })

  it('runs the Windows packaging job under native pwsh', () => {
    const windows = jobNamed(workflow, 'windows')
    expect(windows['runs-on']).toMatch(/^windows-/)
    const steps = jobSteps(workflow, 'windows')
    for (const step of steps) {
      expect(step.shell ?? 'pwsh', 'Windows steps must not use bash').not.toBe('bash')
    }
  })

  it('verifies public download URLs after publishing', () => {
    expect(source).toContain('name: Verify public download URLs and checksums')
    expect(source).toContain('sha256sum -c SHA256SUMS')
  })

  it('fails closed on CI and never hides build errors', () => {
    expect(runText(jobNamed(workflow, 'gate'))).toContain('no successful push CI workflow run exists')
    expect(source).not.toContain('continue-on-error: true')
    expect(source).not.toMatch(/\|\|\s*true/)
  })
})
