import { describe, expect, it } from 'vitest'
import { parseManifest } from '../src/manifest.ts'
import { headlessTemplateViolations } from '../src/launch-template.ts'

function templateManifest(headless: string, transport: 'mcp' | 'serve' = 'mcp', controlToken = 'unused'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'testcraft',
    displayName: 'TestCraft',
    aliases: [],
    cliStem: 'testcraft',
    platforms: ['win32', 'linux'],
    headlessSupported: true,
    transport,
    minVersion: '1.0.0',
    verified: false,
    attach: { supported: false, enabled: false, reason: 'gated' },
    launch: { headless, connected: 'testcraft --control {jobRoot}' },
    roots: { read: 'workspace', write: 'job-out' },
    cancellation: 'child-process-kill',
    riskyCommandClasses: ['overwrite'],
    sources: [{ label: 'docs', url: 'https://example.test/docs', date: '2026-10-26', verified: false }],
    recipe: { name: 'craft-testcraft', description: 'test recipe', file: 'recipes/testcraft.md' },
    headless: {
      listMethod: 'command_list',
      registryMethod: transport === 'serve' ? 'engine.commands' : null,
      trustedRegistryHash: null,
      toolFilter: ['command_list'],
      artifactTools: [],
      artifactPatterns: [],
      controlToken,
    },
  }
}

describe('S5-09f launch contract', () => {
  it('refuses a template without {cli} on both transports', () => {
    expect(() => parseManifest(templateManifest('testcraft-cli mcp --automation-read-root {readRoot} --automation-write-root {writeRoot}')))
      .toThrow(/must open with \{cli\}/)
    expect(() => parseManifest(templateManifest('testcraft-cli serve --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}', 'serve', 'required')))
      .toThrow(/must open with \{cli\}/)
  })

  it('refuses a template without the read root', () => {
    expect(() => parseManifest(templateManifest('{cli} mcp --automation-write-root {writeRoot}')))
      .toThrow(/must reference \{readRoot\}/)
    expect(() => parseManifest(templateManifest('{cli} serve --automation-write-root {writeRoot} --control-token-file {controlTokenFile}', 'serve', 'required')))
      .toThrow(/must reference \{readRoot\}/)
  })

  it('refuses a template without the write root', () => {
    expect(() => parseManifest(templateManifest('{cli} mcp --automation-read-root {readRoot}')))
      .toThrow(/must reference \{writeRoot\}/)
    expect(() => parseManifest(templateManifest('{cli} serve --automation-read-root {readRoot} --control-token-file {controlTokenFile}', 'serve', 'required')))
      .toThrow(/must reference \{writeRoot\}/)
  })

  it('refuses a serve template without the control-token file', () => {
    expect(() => parseManifest(templateManifest('{cli} serve --automation-read-root {readRoot} --automation-write-root {writeRoot}', 'serve', 'required')))
      .toThrow(/must reference \{controlTokenFile\}/)
  })

  it('accepts the PdfCraft MCP template with the unused token', () => {
    const manifest = parseManifest(templateManifest(
      '{cli} mcp --automation-read-root {readRoot} --automation-write-root {writeRoot}',
    ))
    expect(manifest.launch.headless).toContain('mcp')
    expect(headlessTemplateViolations(manifest.launch.headless, false)).toEqual([])
  })

  it('accepts the serve template with the required token', () => {
    const manifest = parseManifest(templateManifest(
      '{cli} serve --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
      'serve',
      'required',
    ))
    expect(headlessTemplateViolations(manifest.launch.headless, true)).toEqual([])
  })
})
