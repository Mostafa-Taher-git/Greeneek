import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTempWorkspaces, createTempWorkspace, writeWorkspaceFile } from './lib/temp-workspace.ts'
import { bareWorkspaceImports, inspectDependencyRules } from './verify-dependency-rules.ts'

afterEach(cleanupTempWorkspaces)

function createRoot(): string {
  const root = createTempWorkspace('gnk-dep-rules-')
  writeWorkspaceFile(root, 'vendor/README.md', '# Vendored\n')
  return root
}

function writePackage(
  root: string,
  directory: string,
  name: string,
  deps: string[],
  srcSource = '',
): void {
  const manifest: Record<string, unknown> = {
    name,
    dependencies: Object.fromEntries(deps.map(dep => [dep, 'workspace:^'])),
  }
  writeWorkspaceFile(root, `${directory}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  writeWorkspaceFile(root, `${directory}/src/index.ts`, srcSource)
}

describe('dependency rules gate', () => {
  it('extracts bare workspace specifiers', () => {
    expect(bareWorkspaceImports("import { x } from '@greeneek/gnk-llm'\nconst y = require('node:fs')"))
      .toEqual([{ specifier: '@greeneek/gnk-llm', typeOnly: false, dynamic: false }])
  })

  it('passes a declared, acyclic, isolated workspace', () => {
    const root = createRoot()
    writePackage(root, 'packages/llm/llm', '@greeneek/gnk-llm', [])
    writePackage(root, 'packages/core/agent', '@greeneek/gnk-agent', ['@greeneek/gnk-llm'],
      "import type { X } from '@greeneek/gnk-llm'\nexport type X = string\n")
    const report = inspectDependencyRules(root)
    expect(report.failures).toEqual([])
    expect(report.packageCount).toBe(2)
  })

  it('fails a deep src import', () => {
    const root = createRoot()
    writePackage(root, 'packages/llm/llm', '@greeneek/gnk-llm', [])
    writePackage(root, 'packages/core/agent', '@greeneek/gnk-agent', ['@greeneek/gnk-llm'],
      "import { x } from '@greeneek/gnk-llm/src/index.ts'\n")
    expect(inspectDependencyRules(root).failures.some(f => f.rule === 'no-deep-src-imports')).toBe(true)
  })

  it('fails a src import of the concrete agent loop', () => {
    const root = createRoot()
    writePackage(root, 'packages/core/agent-loop', '@greeneek/gnk-agent-loop', [])
    writePackage(root, 'packages/core/agent', '@greeneek/gnk-agent', ['@greeneek/gnk-agent-loop'],
      "import AgentLoop from '@greeneek/gnk-agent-loop'\nexport default AgentLoop\n")
    expect(inspectDependencyRules(root).failures.some(f => f.rule === 'agent-loop-isolation')).toBe(true)
  })

  it('allows test imports of the concrete agent loop (real-composition evidence)', () => {
    const root = createRoot()
    writePackage(root, 'packages/core/agent-loop', '@greeneek/gnk-agent-loop', [])
    writePackage(root, 'packages/core/agent', '@greeneek/gnk-agent', ['@greeneek/gnk-agent-loop'])
    writeWorkspaceFile(root, 'packages/core/agent/tests/loop.spec.ts', "import AgentLoop from '@greeneek/gnk-agent-loop'\n")
    expect(inspectDependencyRules(root).failures).toEqual([])
  })

  it('fails a vendor import of a harness package', () => {
    const root = createRoot()
    writePackage(root, 'packages/llm/llm', '@greeneek/gnk-llm', [])
    writeWorkspaceFile(root, 'vendor/cordis/package.json', `${JSON.stringify({ name: '@greeneek/cordis' }, null, 2)}\n`)
    writeWorkspaceFile(root, 'vendor/cordis/src/index.ts', "import { x } from '@greeneek/gnk-llm'\nexport {}\n")
    expect(inspectDependencyRules(root).failures.some(f => f.rule === 'vendor-isolation')).toBe(true)
  })

  it('fails a two-package import cycle', () => {
    const root = createRoot()
    writePackage(root, 'packages/a/a', '@greeneek/gnk-a', ['@greeneek/gnk-b'], "import '@greeneek/gnk-b'\n")
    writePackage(root, 'packages/b/b', '@greeneek/gnk-b', ['@greeneek/gnk-a'], "import '@greeneek/gnk-a'\n")
    expect(inspectDependencyRules(root).failures.some(f => f.rule === 'no-package-cycles')).toBe(true)
  })

  it('fails an undeclared dependency', () => {
    const root = createRoot()
    writePackage(root, 'packages/llm/llm', '@greeneek/gnk-llm', [])
    writePackage(root, 'packages/core/agent', '@greeneek/gnk-agent', [], "import '@greeneek/gnk-llm'\n")
    expect(inspectDependencyRules(root).failures.some(f => f.rule === 'declared-dependencies')).toBe(true)
  })
})
