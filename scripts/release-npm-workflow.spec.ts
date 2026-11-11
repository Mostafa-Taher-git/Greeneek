/** Structural pins for the artifact-first npm baseline workflow. */
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



describe('npm baseline release workflow', () => {
  const workflow = loadWorkflow('.github/workflows/release-npm.yml')

  it('packs on pull requests and publishes only on manual dispatch, never on push', () => {
    if (!isRecord(workflow.on)) throw new TypeError('release workflow must define triggers')
    expect(isRecord(workflow.on.pull_request)).toBe(true)
    expect(workflow.on.push).toBeUndefined()
    expect(workflow.on.workflow_dispatch).toBeDefined()
  })

  it('offers ref and registry dispatch inputs for the pack phase', () => {
    if (!isRecord(workflow.on)) throw new TypeError('release workflow must define triggers')
    const dispatch = workflow.on.workflow_dispatch
    if (!isRecord(dispatch) || !isRecord(dispatch.inputs)) {
      throw new TypeError('release workflow must define dispatch inputs')
    }
    expect(dispatch.inputs.ref).toMatchObject({ required: false, default: 'HEAD' })
    expect(dispatch.inputs.registry).toMatchObject({ required: false })
  })

  it('packs credential-free and uploads the bundle artifact', () => {
    const packTest = jobNamed(workflow, 'pack-test')
    expect(packTest['runs-on']).toBe('ubuntu-latest')
    const runs = runText(packTest)
    expect(runs).toContain('pnpm run publish:npm-baseline pack')
    expect(runs).toContain('--yes')
    expect(runs).not.toContain('secrets.')

    const steps = jobSteps(workflow, 'pack-test')
    const upload = steps.find(step => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact@'))
    if (!isRecord(upload)) throw new TypeError('pack-test must upload the release bundle')
    expect(upload.with).toMatchObject({ name: 'npm-baseline-bundle' })
  })

  it('publishes the tested bundle behind the protected environment', () => {
    const publish = jobNamed(workflow, 'publish')
    expect(publish.needs).toBe('pack-test')
    expect(publish.if).toBe('${{ github.event_name == \'workflow_dispatch\' }}')
    expect(publish.environment).toBe('npm-baseline')
    expect(publish['runs-on']).toBe('ubuntu-latest')

    const steps = jobSteps(workflow, 'publish')
    const download = steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/download-artifact@'),
    )
    if (!isRecord(download)) throw new TypeError('publish must download the tested bundle')
    expect(download.with).toMatchObject({ name: 'npm-baseline-bundle' })

    const runs = runText(publish)
    // The manifest is revalidated before anything uploads; publishing always
    // consumes the downloaded bundle, never a rebuilt workspace tree.
    expect(runs.indexOf('verify --manifest')).toBeGreaterThanOrEqual(0)
    expect(runs.indexOf('publish --manifest')).toBeGreaterThan(runs.indexOf('verify --manifest'))
  })

  it('injects the registry token only into the publish job', () => {
    const packRaw = readFileSync(resolve(root, '.github/workflows/release-npm.yml'), 'utf8')
    expect(packRaw).toContain('secrets.NPM_TOKEN')
    expect(runText(jobNamed(workflow, 'pack-test'))).not.toContain('secrets.')
    expect(runText(jobNamed(workflow, 'publish'))).not.toContain('secrets.NPM_TOKEN')
    const setupNode = jobSteps(workflow, 'publish').find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@'),
    )
    if (!isRecord(setupNode)) throw new TypeError('publish must configure the registry token')
    expect(setupNode.env).toMatchObject({ NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' })
  })

  it('pins every action to a full commit SHA on a Node 24 major', () => {
    assertWorkflowActionsPinned('.github/workflows/release-npm.yml')
  })

  it('does not pin pnpm twice', () => {
    for (const step of jobSteps(workflow, 'pack-test').concat(jobSteps(workflow, 'publish'))) {
      if (typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@')) {
        expect(step.with).toBeUndefined()
      }
    }
  })
})
