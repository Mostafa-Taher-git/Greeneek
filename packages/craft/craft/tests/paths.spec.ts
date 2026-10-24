import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  confineArtifact,
  CONTROL_TOKEN_FILE,
  controlTokenPath,
  craftRoots,
  resolveWorkspaceRoot,
} from '../src/paths.ts'

describe('workspace roots', () => {
  it('normalizes an absolute workspace and derives the job out directory', () => {
    const root = resolveWorkspaceRoot(join(resolve('.'), 'workspace'))
    expect(root).toBe(resolve('workspace'))
    expect(craftRoots(root)).toEqual({ read: root, write: join(root, 'out') })
    expect(controlTokenPath({ read: root, write: join(root, 'out') }))
      .toBe(join(root, 'out', CONTROL_TOKEN_FILE))
  })

  it('rejects empty and relative roots', () => {
    expect(() => resolveWorkspaceRoot('')).toThrow(expect.objectContaining({ code: 'CRAFT_ROOT_INVALID' }))
    expect(() => resolveWorkspaceRoot('   ')).toThrow(expect.objectContaining({ code: 'CRAFT_ROOT_INVALID' }))
    expect(() => resolveWorkspaceRoot('relative/path')).toThrow(expect.objectContaining({
      code: 'CRAFT_ROOT_INVALID',
      message: expect.stringContaining('must be absolute') as unknown as string,
    }))
  })
})

describe('artifact confinement', () => {
  const roots = { read: resolve('workspace'), write: resolve('workspace', 'out') }

  it('accepts absolute and relative paths inside the write root', () => {
    expect(confineArtifact(roots, 'preview.png')).toBe(resolve(roots.write, 'preview.png'))
    expect(confineArtifact(roots, join(roots.write, 'nested', 'page-1.png')))
      .toBe(resolve(roots.write, 'nested', 'page-1.png'))
  })

  it('rejects escapes, empty paths, and the write root itself', () => {
    for (const artifact of ['../escape.png', 'nested/../../escape.png', resolve('elsewhere', 'x.png'), '', '  ', roots.write]) {
      expect(() => confineArtifact(roots, artifact)).toThrow(expect.objectContaining({ code: 'CRAFT_ROOT_INVALID' }))
    }
    expect(() => confineArtifact(roots, 42 as unknown as string)).toThrow(expect.objectContaining({ code: 'CRAFT_ROOT_INVALID' }))
  })
})
