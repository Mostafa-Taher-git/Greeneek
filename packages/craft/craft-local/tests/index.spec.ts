import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@greeneek/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import { apply, Config, createLocalIo, DEFAULT_CLOSE_GRACE_MS, DEFAULT_GRACE_MS, DEFAULT_REQUEST_TIMEOUT_MS, inject } from '../src/index.ts'
import { CraftLocalProvider } from '../src/provider.ts'

/** Minimal context surface the plugin touches. */
function fakeContext() {
  const dispose = vi.fn()
  const registerProvider = vi.fn((_provider: unknown) => dispose)
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => ({ pid: 7 }) as unknown as SubprocessHandle)
  const warn = vi.fn()
  const effect = vi.fn((callback: () => unknown) => {
    callback()
    return dispose
  })
  const ctx = {
    craft: { registerProvider },
    subprocess: { spawn },
    logger: { warn },
    effect,
  } as unknown as Context
  return { ctx, dispose, registerProvider, spawn, warn, effect }
}

const resolvedConfig = { requestTimeoutMs: 100, graceMs: 50, closeGraceMs: 25 }

describe('dependencies', () => {
  it('waits for the Craft seam and subprocess boundary', () => {
    expect(inject).toEqual(['craft', 'subprocess'])
  })
})

describe('Config', () => {
  it('fills every default', () => {
    expect(Config({} as never)).toEqual({
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      graceMs: DEFAULT_GRACE_MS,
      closeGraceMs: DEFAULT_CLOSE_GRACE_MS,
    })
  })

  it('keeps explicit values', () => {
    expect(Config(resolvedConfig)).toEqual(resolvedConfig)
  })
})

describe('apply', () => {
  it('registers one craft-local provider through the effect scope', () => {
    const fake = fakeContext()

    apply(fake.ctx, resolvedConfig)

    expect(fake.effect).toHaveBeenCalledWith(expect.any(Function), 'craft-local.registerProvider')
    expect(fake.registerProvider).toHaveBeenCalledOnce()
    const provider = fake.registerProvider.mock.calls[0]?.[0]
    expect(provider).toBeInstanceOf(CraftLocalProvider)
    expect((provider as CraftLocalProvider).id).toBe('craft-local')
  })

  it('uses the documented defaults when a composition supplies no config', () => {
    const fake = fakeContext()

    expect(() => { apply(fake.ctx) }).not.toThrow()

    expect(fake.registerProvider).toHaveBeenCalledOnce()
  })

  it('rejects a non-positive, fractional, or out-of-range timer', () => {
    for (const value of [0, 1.5, 2_147_483_648]) {
      expect(() =>{  apply(fakeContext().ctx, { ...resolvedConfig, requestTimeoutMs: value }) })
        .toThrow(/requestTimeoutMs must be a positive integer/)
    }
    expect(() =>{  apply(fakeContext().ctx, { ...resolvedConfig, graceMs: -1 }) })
      .toThrow(/graceMs must be a positive integer/)
    expect(() =>{  apply(fakeContext().ctx, { ...resolvedConfig, closeGraceMs: Number.NaN }) })
      .toThrow(/closeGraceMs must be a positive integer/)
  })
})

describe('createLocalIo', () => {
  it('delegates spawn to ctx.subprocess and warnings to ctx.logger', () => {
    const fake = fakeContext()
    const io = createLocalIo(fake.ctx)

    expect(io.spawn({} as never)).toEqual({ pid: 7 })
    io.warn?.('diagnostic')

    expect(fake.spawn).toHaveBeenCalledOnce()
    expect(fake.warn).toHaveBeenCalledWith('diagnostic')
  })
})

describe('default export', () => {
  it('is the apply function', async () => {
    const module = await import('../src/index.ts')
    expect(module.default).toBe(apply)
  })
})
