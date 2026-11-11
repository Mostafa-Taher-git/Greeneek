/**
 * Keyboard shortcut description and matching for browser surfaces.
 *
 * A shortcut is written as `mod+alt+shift+key`, where `mod` is the platform's
 * command key (Command on macOS, Control elsewhere) and `key` is a single
 * `KeyboardEvent.key` value. The same spec both formats the hint a menu row
 * shows and matches a real key event, so a displayed shortcut and the
 * shortcut that fires can never drift apart.
 */

/** One parsed shortcut. */
export interface ShortcutParts {
  /** The final key, as `KeyboardEvent.key` spells it. */
  readonly key: string
  /** The platform command key is held. */
  readonly mod: boolean
  /** The physical Control key is held. */
  readonly ctrl: boolean
  /** The Alt (Option) key is held. */
  readonly alt: boolean
  /** The Shift key is held. */
  readonly shift: boolean
}

/**
 * Whether the browser runs on macOS.
 *
 * `navigator.userAgentData` is preferred where it exists; the older
 * `navigator.platform` string is the fallback every current engine still
 * answers.
 * @returns true on macOS.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  // The platform details are read defensively: the browser builds that expose
  // them differ, and a host without them still answers a question.
  const host = navigator as unknown as {
    userAgentData?: { platform?: string }
    platform?: string
    userAgent?: string
  }
  const data = host.userAgentData
  const platform = data?.platform ?? host.platform ?? ''
  return /mac/i.test(platform) || /Macintosh/i.test(host.userAgent ?? '')
}

/**
 * Parse one shortcut specification.
 * @param spec - `mod+alt+shift+key` specification.
 * @returns the parsed parts; an unknown modifier is ignored.
 */
export function parseShortcut(spec: string): ShortcutParts {
  const parts = spec.toLowerCase().split('+').map(part => part.trim()).filter(part => part !== '')
  const key = parts.length === 0 ? '' : (parts[parts.length - 1] as string)
  const modifiers = parts.slice(0, -1)
  return {
    key,
    mod: modifiers.includes('mod'),
    ctrl: modifiers.includes('ctrl') || modifiers.includes('control'),
    alt: modifiers.includes('alt') || modifiers.includes('option'),
    shift: modifiers.includes('shift'),
  }
}

/**
 * Format one shortcut for display.
 * @param spec - `mod+alt+shift+key` specification.
 * @param mac - whether the display target is macOS (default: the host platform).
 * @returns the shortcut as the platform spells its modifiers.
 */
export function formatShortcut(spec: string, mac: boolean = isMacPlatform()): string {
  const parts = parseShortcut(spec)
  const tokens: string[] = []
  if (parts.mod) tokens.push(mac ? '⌘' : 'Ctrl')
  if (parts.ctrl) tokens.push('Ctrl')
  if (parts.alt) tokens.push(mac ? '⌥' : 'Alt')
  if (parts.shift) tokens.push(mac ? '⇧' : 'Shift')
  tokens.push(displayKey(parts.key, mac))
  return tokens.join('+')
}

/**
 * Spell one key for display.
 * @param key - `KeyboardEvent.key` value.
 * @param mac - whether the display target is macOS.
 * @returns the key as the platform writes it.
 */
function displayKey(key: string, mac: boolean): string {
  /* v8 ignore next -- a space key cannot be spelled: the parser trims every segment. */
  if (key === ' ') return 'Space'
  if (key.length === 0) return ''
  if (key.length === 1) return key.toUpperCase()
  if (mac) {
    switch (key) {
      case 'arrowup': return '↑'
      case 'arrowdown': return '↓'
      case 'arrowleft': return '←'
      case 'arrowright': return '→'
      case 'escape': return 'Esc'
      default: return key
    }
  }
  switch (key) {
    case 'arrowup': return 'Up'
    case 'arrowdown': return 'Down'
    case 'arrowleft': return 'Left'
    case 'arrowright': return 'Right'
    case 'escape': return 'Esc'
    default: return key.charAt(0).toUpperCase() + key.slice(1)
  }
}

/**
 * Whether one key event matches one shortcut specification.
 *
 * `mod` matches the platform command key: Command on macOS, Control
 * elsewhere. `ctrl` names the physical Control key, which is a distinct key
 * from the command key on macOS and the same key as `mod` elsewhere. A
 * shortcut that names no command key requires that no command key is held, so
 * `g` never fires while Shift is down.
 * @param event - the observed key event.
 * @param spec - `mod+alt+shift+key` specification.
 * @param mac - whether the host is macOS (default: the host platform).
 * @returns true when the event satisfies the specification.
 */
export function shortcutMatches(event: KeyboardEvent, spec: string, mac: boolean = isMacPlatform()): boolean {
  const parts = parseShortcut(spec)
  if (parts.key === '') return false
  if (event.key.toLowerCase() !== parts.key) return false
  const commandHeld = mac ? event.metaKey : event.ctrlKey
  const controlHeld = event.ctrlKey
  if (parts.mod) {
    if (!commandHeld) return false
    // On macOS the command key and Control are distinct, so a held Control
    // means the user pressed something else.
    if (mac && controlHeld) return false
  } else {
    if (commandHeld) return false
    if (controlHeld && !parts.ctrl) return false
  }
  if (parts.ctrl && !controlHeld) return false
  if (parts.alt !== event.altKey) return false
  if (parts.shift !== event.shiftKey) return false
  return true
}

/**
 * Whether one event target accepts typed text.
 *
 * A shortcut must not fire while a field the user is typing into has focus.
 * @param target - the event target.
 * @returns true when the target is an editable element.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
