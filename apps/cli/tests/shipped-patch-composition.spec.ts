/**
 * Every shipped profile composition must resolve each patch row it writes.
 *
 * `checkPatchComposition` refuses a strict layer whose override names no row, so
 * a bundle patch that targets an id the shipped layers never mount now fails here
 * instead of booting with that configuration silently absent — the shape the
 * `image-offload` and `greeneek-defaults` scenarios each sat red on. The gate
 * reads the real `packages/bundle` patches in template order, so a row renamed or
 * dropped in one bundle cannot survive here unseen.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { checkPatchComposition, loadOverlayPatches, PROFILE_TEMPLATES } from '@greeneek/gnk-app-boot'
import { describe, expect, it } from 'vitest'

const BUNDLE_ROOT = resolve(import.meta.dirname, '../../../packages/bundle')

/** Every workspace bundle: its package name and the patch file it declares. */
function shippedBundles(): Map<string, string> {
  const found = new Map<string, string>()
  for (const entry of readdirSync(BUNDLE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(BUNDLE_ROOT, entry.name, 'package.json')
    // A directory without a manifest is build or deletion residue, not a bundle.
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      gnk?: { bundle?: { patch?: string } }
    }
    const declared = manifest.gnk?.bundle?.patch
    if (typeof manifest.name !== 'string' || typeof declared !== 'string') continue
    found.set(manifest.name, resolve(dirname(manifestPath), declared))
  }
  return found
}

describe('shipped profile compositions', () => {
  it('patch every row they name, in each template\'s bundle order', () => {
    const bundles = shippedBundles()
    for (const [profile, template] of Object.entries(PROFILE_TEMPLATES)) {
      const layers = template.bundles.map((packageName) => {
        const patch = bundles.get(packageName)
        if (patch === undefined) throw new Error(`${profile}: template names an unknown bundle ${packageName}`)
        return { label: packageName, patches: loadOverlayPatches(profile, patch), strict: true }
      })
      expect(() => { checkPatchComposition(profile, layers) }).not.toThrow()
    }
  })
})
