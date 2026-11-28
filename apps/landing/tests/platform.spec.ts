import { describe, expect, it } from 'vitest'
import {
  DESKTOP_RELEASE_TAG,
  detectPlatform,
  download,
  RELEASES_URL,
} from '../src/lib/platform'

describe('landing download targeting', () => {
  it('detects desktop platforms and rejects Android as unsupported', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('macos')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14)')).toBe('unknown')
    expect(detectPlatform('curl/8.0')).toBe('unknown')
  })

  it('pins every installer to a concrete desktop release', () => {
    expect(DESKTOP_RELEASE_TAG).toMatch(/^desktop-v\d+\.\d+\.\d+$/)
    const prefix = `${RELEASES_URL}/download/${DESKTOP_RELEASE_TAG}/`
    for (const url of [
      download.windowsInstaller,
      download.windowsPortable,
      download.linuxDeb,
      download.linuxAppImage,
    ]) {
      expect(url.startsWith(prefix)).toBe(true)
      expect(url).not.toContain('/latest/download/')
    }
  })
})
