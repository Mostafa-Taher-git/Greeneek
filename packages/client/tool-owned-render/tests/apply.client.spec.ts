// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/apply.ts'

describe('tool-owned-render apply', () => {
  it('registers nine keyed views into tool.call.toolview', () => {
    const registered: string[] = []
    const fakeSlots = {
      inject: (_name: string, factory: () => Iterable<unknown>) => {
        for (const _ of factory()) void _
      },
      register: (options: { name: string; key?: string }) => {
        registered.push(`${options.name}:${options.key ?? ''}`)
        return () => {}
      },
    }
    const fakeCtx = { slots: fakeSlots } as never
    apply(fakeCtx)
    expect(registered).toEqual([
      'tool.call.toolview:read',
      'tool.call.toolview:read_image',
      'tool.call.toolview:bash',
      'tool.call.toolview:write',
      'tool.call.toolview:edit',
      'tool.call.toolview:grep',
      'tool.call.toolview:glob',
      'tool.call.toolview:web_search',
      'tool.call.toolview:web_fetch',
    ])
  })
})
