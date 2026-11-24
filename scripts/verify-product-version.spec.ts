import { describe, expect, it } from 'vitest'
import { apiReportDrift, isProductName, manifestDrift, type ApiReportHeader, type ProductManifest } from './verify-product-version.ts'

describe('product version drift', () => {
  it('selects the gnk family and Desktop but not independent versions', () => {
    expect(isProductName('@greeneek/gnk-core')).toBe(true)
    expect(isProductName('@greeneek/desktop')).toBe(true)
    expect(isProductName('@greeneek/cordis-core')).toBe(false)
    expect(isProductName('@greeneek/landing')).toBe(false)
    expect(isProductName('@fixture/client')).toBe(false)
  })

  it('reports mismatched and missing manifest versions', () => {
    const manifests: ProductManifest[] = [
      { path: 'packages/core/agent/package.json', name: '@greeneek/gnk-agent', version: '0.8.8' },
      { path: 'packages/deep-agent/core/package.json', name: '@greeneek/gnk-deep-agent-core', version: '1.1.0-alpha.0' },
      { path: 'packages/client/ui-deep-agent/package.json', name: '@greeneek/gnk-client-ui-deep-agent', version: undefined },
    ]
    expect(manifestDrift('0.8.8', manifests)).toEqual([
      'packages/deep-agent/core/package.json declares 1.1.0-alpha.0; expected 0.8.8',
      'packages/client/ui-deep-agent/package.json declares no version; expected 0.8.8',
    ])
  })

  it('accepts an aligned manifest set', () => {
    const manifests: ProductManifest[] = [
      { path: 'apps/desktop/package.json', name: '@greeneek/desktop', version: '0.8.8' },
      { path: 'apps/cli/package.json', name: '@greeneek/gnk', version: '0.8.8' },
    ]
    expect(manifestDrift('0.8.8', manifests)).toEqual([])
  })

  it('checks only first-party API report headers', () => {
    const reports: ApiReportHeader[] = [
      { path: 'etc/gnk-agent.api.md', name: '@greeneek/gnk-agent', version: '0.8.8' },
      { path: 'etc/gnk-deep-agent-core.api.md', name: '@greeneek/gnk-deep-agent-core', version: '1.1.0-alpha.0' },
      { path: 'etc/cordis-core.api.md', name: '@greeneek/cordis-core', version: '1.0.2' },
    ]
    expect(apiReportDrift('0.8.8', reports)).toEqual([
      'etc/gnk-deep-agent-core.api.md reports @greeneek/gnk-deep-agent-core@1.1.0-alpha.0; expected 0.8.8',
    ])
  })
})
