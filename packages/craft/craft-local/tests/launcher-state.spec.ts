import { describe, expect, it } from 'vitest'
import { loadPilotCatalog } from '@greeneek/gnk-craft'
import { launcherRonPath, parseLauncherAppRon } from '../src/platform.ts'

describe('ArtCraft launcher state discovery', () => {
  it('reads the per-app install map and ignores unrelated state', () => {
    const pdfcraft = loadPilotCatalog().require('pdfcraft')
    const state = String.raw`per_app:{"pdfcraft":"T:\\APPS\\OfficeCraft","photocraft":"T:\\E\\APPS\\ArtCraft"}`

    expect(parseLauncherAppRon(state, pdfcraft))
      .toEqual({ installDir: String.raw`T:\APPS\OfficeCraft` })
    expect(parseLauncherAppRon('nothing here', pdfcraft)).toBeUndefined()
    expect(parseLauncherAppRon('per_app:{"other":"X:\\\\Y"}', pdfcraft)).toBeUndefined()
  })

  it('locates the launcher state only on Windows and honors APPDATA', () => {
    expect(launcherRonPath('linux', {}, '/home/me')).toBeUndefined()
    expect(launcherRonPath('win32', { APPDATA: String.raw`C:\Roaming` }, String.raw`C:\Users\me`))
      .toBe(String.raw`C:\Roaming\ai.storyteller.artcraft-launcher\data\app.ron`)
    expect(launcherRonPath('win32', {}, String.raw`C:\Users\me`))
      .toBe(String.raw`C:\Users\me\AppData\Roaming\ai.storyteller.artcraft-launcher\data\app.ron`)
  })

  it('ignores a blank install directory', () => {
    const pdfcraft = loadPilotCatalog().require('pdfcraft')
    expect(parseLauncherAppRon(String.raw`per_app:{"pdfcraft":""}`, pdfcraft)).toBeUndefined()
  })

  it('accepts the escaped quotes and doubled separators in app.ron', () => {
    const pdfcraft = loadPilotCatalog().require('pdfcraft')
    const state = String.raw`settings: "(install_locations:(root:None,per_app:{\"pdfcraft\":\"T:\\\\APPS\\\\OfficeCraft\"}),view:Table))"`

    expect(parseLauncherAppRon(state, pdfcraft)?.installDir).toBe(String.raw`T:\\APPS\\OfficeCraft`)
  })
})
