import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectPublishedPackages, renderReport } from './gen-api-reports.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(root: string, file: string, content: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gnk-api-reports-'))
  roots.push(root)
  return root
}

describe('API reports gate', () => {
  it('discovers the publication set and excludes experimental and private packages', () => {
    const root = createRoot()
    writeFile(root, 'vendor/cordis/package.json', `${JSON.stringify({ name: '@greeneek/cordis', version: '4.0.0' }, null, 2)}\n`)
    writeFile(root, 'packages/llm/llm/package.json', `${JSON.stringify({ name: '@greeneek/gnk-llm', version: '1.0.0' }, null, 2)}\n`)
    writeFile(root, 'packages/experimental/exp/package.json', `${JSON.stringify({ name: '@greeneek/gnk-experimental-exp', version: '1.0.0', private: true }, null, 2)}\n`)
    const packages = collectPublishedPackages(root)
    expect(packages.map(p => p.name).sort()).toEqual(['@greeneek/cordis', '@greeneek/gnk-llm'])
    expect(packages.find(p => p.name === '@greeneek/gnk-llm')?.shortName).toBe('gnk-llm')
  })

  it('renders one sorted export line per exported declaration', () => {
    const root = createRoot()
    writeFile(root, 'packages/llm/llm/package.json', `${JSON.stringify({ name: '@greeneek/gnk-llm', version: '1.0.0' }, null, 2)}\n`)
    writeFile(root, 'packages/llm/llm/src/index.ts', 'export class Zebra {}\nexport class Alpha {}\nconst hidden = 1\n')
    writeFile(root, 'packages/llm/llm/src/types.ts', 'export interface Foo {}\n')
    const [pkg] = collectPublishedPackages(root)
    const report = renderReport(root, pkg!)
    expect(report).toContain('# API report: @greeneek/gnk-llm@1.0.0')
    expect(report).toContain('`src/index.ts: export class Alpha {}`')
    expect(report).not.toContain('hidden')
    expect(report.indexOf('Alpha')).toBeLessThan(report.indexOf('Zebra'))
  })

  it('fails loud on an unparsable manifest', () => {
    const root = createRoot()
    writeFile(root, 'vendor/cordis/package.json', 'not json\n')
    expect(() => collectPublishedPackages(root)).toThrow()
  })
})
