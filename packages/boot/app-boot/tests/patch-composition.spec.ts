/**
 * `checkPatchComposition` refuses a patch row that only a repository-owned layer
 * could be wrong about (strict: a shipped bundle or the profile's own layer) and
 * tolerates the same shape in a machine-local layer (lenient: `$GNK_HOME` and
 * `--patch` overlays), whose skip the mounted loader and `--dump-config` already
 * report through their own channels. The layers here are patch lists, not files,
 * so the assertions isolate the attribution rule from YAML loading.
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
 * @param label - the name the refusal must carry.
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

  it('tolerates a lenient overlay that names a row this tree lacks', () => {
    // One shared overlay is not expected to match every tree; the mount's own
    // logger and --dump-config report the skip, so the boot proceeds.
    const accept = (): void => {
      checkPatchComposition('gnk', [layer('/home/u/overlay.yml', override('absent', 1), false)])
    }
    expect(accept).not.toThrow()
  })

  it('writes nothing to stderr, which machine surfaces read as a failed boot', () => {
    // The recorded-session headless suite asserts an empty stderr for a
    // successful run, so a lenient skip must not be echoed from this path.
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      checkPatchComposition('gnk', [
        layer('@greeneek/gnk-base', inserter('fs'), true),
        layer('/home/u/cordis.patch.yml', override('ghost', 1), false),
      ])
      expect(written).not.toHaveBeenCalled()
    } finally {
      written.mockRestore()
    }
  })

  it('stays silent when a lower layer inserts the row a strict layer overrides', () => {
    const accept = (): void => {
      checkPatchComposition('gnk', [
        layer('@greeneek/gnk-base', inserter('llm'), true),
        layer('my-profile/cordis.patch.yml', override('llm', 2), true),
      ])
    }
    expect(accept).not.toThrow()
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

  it('blames the strict layer that wrote the row, not the lenient one above it', () => {
    const accept = (): void => {
      checkPatchComposition('gnk', [
        layer('/home/u/overlay.yml', override('ghost', 1), false),
        layer('@greeneek/gnk-headless', override('missing-here', 2), true),
      ])
    }
    expect(accept).toThrow('@greeneek/gnk-headless patches a row')
    expect(accept).not.toThrow('overlay.yml patches a row')
  })

  it('accepts a composition with no layers at all', () => {
    const accept = (): void => { checkPatchComposition('gnk', []) }
    expect(accept).not.toThrow()
  })
})
