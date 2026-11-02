/**
 * `checkPatchComposition` decides, per layer, whether a patch the mount would
 * skip is a defect (strict: a shipped bundle or the profile's own layer) or a
 * plausible inapplicability (lenient: `$GNK_HOME` and `--patch` overlays). The
 * layers here are patch lists, not files, so the assertions isolate the
 * attribution rule from YAML loading.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PatchOptions } from '@greeneek/cordis-plugin-include'
import { checkPatchComposition, type NamedPatchLayer } from '../src/index.ts'

/** One override of a row this tree may or may not carry. */
const override = (id: string, v: number): PatchOptions[] => [{ id, config: { v } }]
/** One layer that adds a row to the empty root. */
const inserter = (id: string): PatchOptions[] => [{ insert: [{ id, name: `pkg-${id}` }] }]

/**
 * Layer under test, named for the assertion that reads it.
 * @param label - the name the diagnostic must carry.
 * @param patches - the layer's patch list.
 * @param strict - whether an unmatched target here is refused.
 * @returns a layer entry for {@link checkPatchComposition}.
 */
function layer(label: string, patches: PatchOptions[], strict: boolean): NamedPatchLayer {
  return { label, patches, strict }
}

describe('checkPatchComposition', () => {
  it('refuses a strict layer that overrides a row no layer carries', () => {
    const refuse = (): void => {
      checkPatchComposition('gnk', [layer('@greeneek/gnk-base', override('absent', 1), true)])
    }
    expect(refuse).toThrow('@greeneek/gnk-base patches a row this composition does not carry')
  })

  it('names the missing id and the remedy in the refusal', () => {
    const refuse = (): void => {
      checkPatchComposition('gnk', [layer('gnk-web-app', override('absent', 1), true)])
    }
    expect(refuse).toThrow(/"absent"/)
    expect(refuse).toThrow('Add the row with `- insert:` or target an id a lower layer declares.')
  })

  it('reports rather than refuses a lenient overlay that names a row this tree lacks', () => {
    const warn = vi.fn()
    const accept = (): void => {
      checkPatchComposition('gnk', [layer('/home/u/overlay.yml', override('absent', 1), false)], warn)
    }
    expect(accept).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/home/u/overlay.yml skipped a patch'))
  })

  it('stays silent when a lower layer inserts the row a strict layer overrides', () => {
    const warn = vi.fn()
    const accept = (): void => {
      checkPatchComposition('gnk', [
        layer('@greeneek/gnk-base', inserter('llm'), true),
        layer('my-profile/cordis.patch.yml', override('llm', 2), true),
      ], warn)
    }
    expect(accept).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('refuses an override naming a row only a later layer inserts, because the mount skips it', () => {
    // Patches apply in order over one flattened call, so ordering is semantics,
    // not style: the earlier override matches nothing when it is reached.
    const refuse = (): void => {
      checkPatchComposition('gnk', [
        layer('gnk-profile', override('late', 1), true),
        layer('gnk-base', inserter('late'), true),
      ])
    }
    expect(refuse).toThrow('gnk-profile patches a row this composition does not carry')
  })

  it('attributes each skipped patch to the layer that wrote it, not the one below', () => {
    const warn = vi.fn()
    checkPatchComposition('gnk', [
      layer('@greeneek/gnk-base', inserter('fs'), true),
      layer('/home/u/cordis.patch.yml', override('fs', 1).concat(override('ghost', 2)), false),
    ], warn)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ghost"'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/home/u/cordis.patch.yml'))
  })

  it('accepts a composition with no layers at all', () => {
    const warn = vi.fn()
    const accept = (): void => { checkPatchComposition('gnk', [], warn) }
    expect(accept).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns on stderr when the caller supplies no sink', () => {
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      checkPatchComposition('gnk', [layer('/tmp/overlay.yml', override('absent', 1), false)])
      expect(written).toHaveBeenCalledWith(expect.stringContaining('gnk: /tmp/overlay.yml skipped a patch'))
    } finally {
      written.mockRestore()
    }
  })
})
