import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTempWorkspaces, createTempWorkspace, writeWorkspaceFile } from './lib/temp-workspace.ts'
import { collectPublishedPackages, renderReport } from './gen-api-reports.ts'

afterEach(cleanupTempWorkspaces)

function createRoot(): string {
  return createTempWorkspace('gnk-api-reports-')
}

describe('API reports gate', () => {
  it('discovers the publication set and excludes experimental and private packages', () => {
    const root = createRoot()
    writeWorkspaceFile(root, 'vendor/cordis/package.json', `${JSON.stringify({ name: '@greeneek/cordis', version: '4.0.0' }, null, 2)}\n`)
    writeWorkspaceFile(root, 'packages/llm/llm/package.json', `${JSON.stringify({ name: '@greeneek/gnk-llm', version: '1.0.0' }, null, 2)}\n`)
    writeWorkspaceFile(root, 'packages/experimental/exp/package.json', `${JSON.stringify({ name: '@greeneek/gnk-experimental-exp', version: '1.0.0', private: true }, null, 2)}\n`)
    const packages = collectPublishedPackages(root)
    expect(packages.map(p => p.name).sort()).toEqual(['@greeneek/cordis', '@greeneek/gnk-llm'])
    expect(packages.find(p => p.name === '@greeneek/gnk-llm')?.shortName).toBe('gnk-llm')
  })

  it('renders one sorted export line per exported declaration', () => {
    const root = createRoot()
    writeWorkspaceFile(root, 'packages/llm/llm/package.json', `${JSON.stringify({ name: '@greeneek/gnk-llm', version: '1.0.0' }, null, 2)}\n`)
    writeWorkspaceFile(root, 'packages/llm/llm/src/index.ts', 'export class Zebra {}\nexport class Alpha {}\nconst hidden = 1\n')
    writeWorkspaceFile(root, 'packages/llm/llm/src/types.ts', 'export interface Foo {}\n')
    const [pkg] = collectPublishedPackages(root)
    const report = renderReport(root, pkg!)
    expect(report).toContain('# API report: @greeneek/gnk-llm@1.0.0')
    expect(report).toContain('`src/index.ts: export class Alpha {}`')
    expect(report).not.toContain('hidden')
    expect(report.indexOf('Alpha')).toBeLessThan(report.indexOf('Zebra'))
  })

  it('fails loud on an unparsable manifest', () => {
    const root = createRoot()
    writeWorkspaceFile(root, 'vendor/cordis/package.json', 'not json\n')
    expect(() => collectPublishedPackages(root)).toThrow()
  })
})
