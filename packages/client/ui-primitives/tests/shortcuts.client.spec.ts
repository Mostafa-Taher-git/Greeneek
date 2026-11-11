// @vitest-environment jsdom
/** Shortcut specification parsing, display, matching, and editable-target behavior. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatShortcut,
  isEditableTarget,
  isMacPlatform,
  parseShortcut,
  shortcutMatches,
} from '../src/shortcuts.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** One key event with the given modifiers. */
function keyEvent(key: string, modifiers: {
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
} = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    altKey: modifiers.altKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  } as KeyboardEvent
}

describe('isMacPlatform', () => {
  it('reports a macOS host from the platform data', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } })
    expect(isMacPlatform()).toBe(true)
  })

  it('falls back to the legacy platform string', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(isMacPlatform()).toBe(true)
  })

  it('falls back to the user agent when no platform string exists', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })
    expect(isMacPlatform()).toBe(true)
  })

  it('reports a non-macOS host', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
    expect(isMacPlatform()).toBe(false)
  })

  it('reports a non-macOS host without a platform string', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
    expect(isMacPlatform()).toBe(false)
  })

  it('reports a host without a navigator as non-macOS', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isMacPlatform()).toBe(false)
  })

  it('reports a host without platform or user agent details as non-macOS', () => {
    vi.stubGlobal('navigator', {})
    expect(isMacPlatform()).toBe(false)
  })
})

describe('parseShortcut', () => {
  it('reads the modifiers a specification names', () => {
    expect(parseShortcut('mod+alt+shift+g')).toEqual({
      key: 'g', mod: true, ctrl: false, alt: true, shift: true,
    })
    expect(parseShortcut('ctrl+k')).toEqual({
      key: 'k', mod: false, ctrl: true, alt: false, shift: false,
    })
  })

  it('reads the Control spelling and the Option spelling', () => {
    expect(parseShortcut('control+k').ctrl).toBe(true)
    expect(parseShortcut('option+k').alt).toBe(true)
  })

  it('ignores an unknown modifier and an empty specification', () => {
    expect(parseShortcut('hyper+g').mod).toBe(false)
    expect(parseShortcut('').key).toBe('')
  })
})

describe('formatShortcut', () => {
  it('spells the command key per platform', () => {
    expect(formatShortcut('mod+alt+g', false)).toBe('Ctrl+Alt+G')
    expect(formatShortcut('mod+alt+g', true)).toBe('⌘+⌥+G')
  })

  it('names the physical Control key and special keys', () => {
    expect(formatShortcut('ctrl+k', true)).toBe('Ctrl+K')
    expect(formatShortcut('mod+shift+arrowup', false)).toBe('Ctrl+Shift+Up')
    expect(formatShortcut('mod+escape', true)).toBe('⌘+Esc')
  })

  it('spells an empty specification as no text', () => {
    expect(formatShortcut('', false)).toBe('')
  })

  it('names the remaining arrow and escape keys per platform', () => {    expect(formatShortcut('mod+arrowdown', true)).toBe('⌘+↓')
    expect(formatShortcut('mod+arrowleft', true)).toBe('⌘+←')
    expect(formatShortcut('mod+arrowright', true)).toBe('⌘+→')
    expect(formatShortcut('mod+escape', false)).toBe('Ctrl+Esc')
    expect(formatShortcut('mod+enter', false)).toBe('Ctrl+Enter')
    expect(formatShortcut('mod+arrowup', true)).toBe('⌘+↑')
    expect(formatShortcut('mod+arrowdown', false)).toBe('Ctrl+Down')
    expect(formatShortcut('mod+arrowleft', false)).toBe('Ctrl+Left')
    expect(formatShortcut('mod+arrowright', false)).toBe('Ctrl+Right')
    expect(formatShortcut('mod+enter', true)).toBe('⌘+enter')
    expect(formatShortcut('mod+shift+g', true)).toBe('⌘+⇧+G')
  })
})

describe('shortcutMatches', () => {
  it('matches the command key where it is Control', () => {
    expect(shortcutMatches(keyEvent('g', { ctrlKey: true, altKey: true }), 'mod+alt+g', false)).toBe(true)
    expect(shortcutMatches(keyEvent('g', { ctrlKey: true, altKey: true }), 'mod+alt+g', true)).toBe(false)
  })

  it('matches the command key where it is Command', () => {
    expect(shortcutMatches(keyEvent('g', { metaKey: true, altKey: true }), 'mod+alt+g', true)).toBe(true)
    expect(shortcutMatches(keyEvent('g', { metaKey: true, altKey: true }), 'mod+alt+g', false)).toBe(false)
  })

  it('refuses a macOS command shortcut while Control is held', () => {
    expect(shortcutMatches(keyEvent('g', { metaKey: true, ctrlKey: true, altKey: true }), 'mod+alt+g', true))
      .toBe(false)
  })

  it('matches the physical Control key on macOS', () => {
    expect(shortcutMatches(keyEvent('k', { ctrlKey: true }), 'ctrl+k', true)).toBe(true)
    expect(shortcutMatches(keyEvent('k', { ctrlKey: true }), 'ctrl+k', false)).toBe(false)
  })

  it('requires every named modifier and refuses an unnamed one', () => {
    expect(shortcutMatches(keyEvent('a', { ctrlKey: true, shiftKey: true }), 'mod+shift+a', false)).toBe(true)
    expect(shortcutMatches(keyEvent('a', { ctrlKey: true }), 'mod+shift+a', false)).toBe(false)
    expect(shortcutMatches(keyEvent('g', { shiftKey: true }), 'g', false)).toBe(false)
    expect(shortcutMatches(keyEvent('g'), 'g', false)).toBe(true)
  })

  it('refuses a shortcut whose Alt requirement is unmet', () => {
    expect(shortcutMatches(keyEvent('g', { ctrlKey: true }), 'mod+alt+g', false)).toBe(false)
  })

  it('refuses a modifier-free shortcut while the command key is held', () => {
    expect(shortcutMatches(keyEvent('g', { ctrlKey: true }), 'alt+g', false)).toBe(false)
    expect(shortcutMatches(keyEvent('g', { ctrlKey: true }), 'alt+g', true)).toBe(false)
  })

  it('refuses a Control shortcut while Control is not held', () => {
    expect(shortcutMatches(keyEvent('k'), 'ctrl+k', false)).toBe(false)
  })

  it('compares the key case-insensitively and refuses a different key', () => {
    expect(shortcutMatches(keyEvent('G', { ctrlKey: true }), 'mod+g', false)).toBe(true)
    expect(shortcutMatches(keyEvent('h', { ctrlKey: true }), 'mod+g', false)).toBe(false)
  })

  it('refuses an empty specification', () => {
    expect(shortcutMatches(keyEvent('g', { ctrlKey: true }), '', false)).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('reports inputs, textareas, selects, and contenteditable hosts', () => {
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isEditableTarget(document.createElement('input'))).toBe(true)
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.createElement('select'))).toBe(true)
    expect(isEditableTarget(editable)).toBe(true)
  })

  it('reports a plain element and a non-element target as not editable', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})
