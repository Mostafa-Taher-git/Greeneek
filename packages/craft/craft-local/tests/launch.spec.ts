import { describe, expect, it } from 'vitest'
import { CraftError, loadPilotCatalog } from '@greeneek/gnk-craft'
import { expandHeadlessLaunch } from '../src/launch.ts'
import type { HeadlessLaunchValues } from '../src/launch.ts'

const photocraft = loadPilotCatalog().require('photocraft')

const VALUES: HeadlessLaunchValues = {
  app: 'TestCraft',
  cli: 'C:\\Apps\\TestCraft\\testcraft-cli.exe',
  readRoot: 'C:\\job',
  writeRoot: 'C:\\job\\out',
  controlTokenFile: 'C:\\job\\out\\.craft-control-token',
}

/** Expect one refusal carrying the `CRAFT_MANIFEST_INVALID` code. */
function expectRefusal(template: string, fragment: string): void {
  expect(() => expandHeadlessLaunch(template, VALUES)).toThrow(expect.objectContaining({
    name: 'CraftError',
    code: 'CRAFT_MANIFEST_INVALID',
    message: expect.stringContaining(fragment) as unknown as string,
  }))
}

describe('expandHeadlessLaunch', () => {
  it('expands the shipped PhotoCraft template into the proven serve invocation', () => {
    expect(expandHeadlessLaunch(photocraft.launch.headless, VALUES)).toEqual([
      VALUES.cli,
      'serve',
      '--automation-read-root',
      VALUES.readRoot,
      '--automation-write-root',
      VALUES.writeRoot,
      '--control-token-file',
      VALUES.controlTokenFile,
    ])
  })

  it('substitutes placeholders inside a glued token and keeps literal runs', () => {
    expect(expandHeadlessLaunch(
      '{cli} serve --write-root={writeRoot} --token={controlTokenFile} --read-root={readRoot}',
      VALUES,
    )).toEqual([
      VALUES.cli,
      'serve',
      `--write-root=${VALUES.writeRoot}`,
      `--token=${VALUES.controlTokenFile}`,
      `--read-root=${VALUES.readRoot}`,
    ])
  })

  it('collapses repeated whitespace between tokens', () => {
    expect(expandHeadlessLaunch(
      '  {cli}\tserve   --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}  ',
      VALUES,
    )[1]).toBe('serve')
  })

  it('refuses an empty template', () => {
    expectRefusal('   ', 'is empty')
  })

  it('refuses a template that does not open with the executable placeholder', () => {
    expectRefusal(
      'testcraft-cli serve --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
      'must open with {cli}',
    )
  })

  it('refuses a template that drops a confined root or the control token', () => {
    expectRefusal('{cli} serve --automation-write-root {writeRoot} --control-token-file {controlTokenFile}', 'must reference {readRoot}')
    expectRefusal('{cli} serve --automation-read-root {readRoot} --control-token-file {controlTokenFile}', 'must reference {writeRoot}')
    expectRefusal('{cli} serve --automation-read-root {readRoot} --automation-write-root {writeRoot}', 'must reference {controlTokenFile}')
  })

  it('refuses an unknown placeholder', () => {
    expectRefusal(
      '{cli} serve --port {port} --automation-read-root {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
      'unknown placeholder {port}',
    )
  })

  it('refuses malformed braces', () => {
    expectRefusal(
      '{cli} serve --automation-read-root {readRoot --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
      'unclosed brace',
    )
    expectRefusal(
      '{cli} serve --automation-read-root} {readRoot} --automation-write-root {writeRoot} --control-token-file {controlTokenFile}',
      'unpaired brace',
    )
  })

  it('reports the display name of the refusing app', () => {
    expect(() => expandHeadlessLaunch('testcraft-cli --headless', VALUES)).toThrow(
      expect.objectContaining({ message: expect.stringContaining('TestCraft') as unknown as string }),
    )
  })

  it('keeps the refusal a CraftError for consumers that branch on codes', () => {
    expect(() => expandHeadlessLaunch('', VALUES)).toThrow(CraftError)
  })
})
