/**
 * Versioned settings and prompt persistence for Deep-agent. Every saved block
 * and prompt is an immutable revision in the authoritative store, so the panel
 * can show history and the runtime can apply a known configuration on boot.
 */
import { key } from '@greeneek/gnk-deep-agent-core'
import type { DeepAgentStore } from '@greeneek/gnk-deep-agent-store'
import type { PromptVersionView, SettingsSaveValue, SettingsView } from './wire-types.ts'

export type { PromptVersionView, RuleView, SettingsSaveValue, SettingsView, SourcePolicyView } from './wire-types.ts'

const DEFAULT_SETTINGS: SettingsView = {
  revision: 0,
  paused: false,
  rules: [
    { id: 'copy', name: 'Copy fixes', enabled: true, instruction: 'Explicit requests to correct wording or punctuation.' },
  ],
  mode: 'observe',
  evalTimeoutSeconds: 120,
  maxWorkers: 3,
  workerDirectory: '',
  prepareCommand: '',
  blockedCommands: [],
  sources: {},
}

const BUILT_IN_PROMPTS: Readonly<Record<string, string>> = {
  router: [
    'You are the Deep-agent Router.',
    'Coordinate work; do not perform long-running implementation yourself.',
    'Assess incoming events against the Policy and choose the narrowest authorized action.',
  ].join('\n'),
  worker: [
    'You are a Deep-agent Worker.',
    'Work only inside the mandate in your assignment prompt.',
    'A follow-up message grants no new permissions.',
    'Finish with a structured report.',
  ].join('\n'),
  admission: [
    'Decide whether the event asks for implementation, names a settled target, and needs no design decision.',
    'Ignore requests whose direction or scope is unsettled.',
  ].join('\n'),
}

type MutableSettings = { -readonly [K in keyof Omit<SettingsView, 'revision'>]: Omit<SettingsView, 'revision'>[K] }

const SETTINGS_KEY = 'settings.document'
const PROMPT_KEY = 'prompts.document'

interface StoredDocument {
  readonly revision: number
  readonly settings: Omit<SettingsView, 'revision'>
}

interface StoredPrompts {
  readonly versions: readonly PromptVersionView[]
}

/** Persist and retrieve settings and prompt revisions. */
export class SettingsStore {
  /** @param store - the authoritative Deep-agent store. */
  constructor(private readonly store: DeepAgentStore) {}

  /**
   * Current settings with its revision.
   * @returns the stored settings or the built-in defaults at revision zero.
   */
  settings(): SettingsView {
    const document = this.store.getSetting(SETTINGS_KEY) as StoredDocument | undefined
    if (document === undefined) return DEFAULT_SETTINGS
    return { ...document.settings, revision: document.revision }
  }

  /**
   * Save one settings block; a stale revision is refused.
   * @param block - settings section to replace.
   * @param value - block-specific fields to persist.
   * @param revision - expected current revision for optimistic concurrency.
   * @returns the saved settings at the next revision.
   */
  save(block: 'policy' | 'eval' | 'executor' | 'sources' | 'pause', value: SettingsSaveValue, revision: number): SettingsView {
    const current = this.settings()
    if (revision !== current.revision) throw new Error(`settings revision ${revision} is stale; current is ${current.revision}`)
    const { revision: _current, ...rest } = current
    const next: MutableSettings = { ...rest }
    switch (block) {
      case 'policy': {
        if (value.rules === undefined || value.mode === undefined) throw new Error('policy requires rules and mode')
        next.rules = value.rules
        next.mode = value.mode
        break
      }
      case 'eval':
        if (typeof value.evalTimeoutSeconds !== 'number' || typeof value.maxWorkers !== 'number') {
          throw new Error('eval requires evalTimeoutSeconds and maxWorkers')
        }
        next.evalTimeoutSeconds = value.evalTimeoutSeconds
        next.maxWorkers = value.maxWorkers
        break
      case 'executor':
        if (typeof value.workerDirectory !== 'string' || typeof value.prepareCommand !== 'string') {
          throw new Error('executor requires workerDirectory and prepareCommand')
        }
        next.workerDirectory = value.workerDirectory
        next.prepareCommand = value.prepareCommand
        next.blockedCommands = Array.isArray(value.blockedCommands) ? value.blockedCommands as string[] : []
        break
      case 'sources':
        if (value.sources === undefined) throw new Error('sources requires a source map')
        next.sources = value.sources
        break
      case 'pause':
        if (typeof value.paused !== 'boolean') throw new Error('pause requires a boolean')
        next.paused = value.paused
        break
    }
    const document: StoredDocument = { revision: revision + 1, settings: next }
    this.store.setSetting(SETTINGS_KEY, document)
    this.store.setSetting(`settings.version.${revision + 1}`, next)
    return { ...next, revision: revision + 1 }
  }

  /**
   * All prompt names with their current text, built-ins included.
   * @returns one version per prompt, sorted by name.
   */
  prompts(): readonly PromptVersionView[] {
    const stored = this.store.getSetting(PROMPT_KEY) as StoredPrompts | undefined
    const overrides = new Map<string, PromptVersionView>()
    for (const version of stored?.versions ?? []) {
      const existing = overrides.get(version.name)
      if (existing === undefined || existing.version < version.version) overrides.set(version.name, version)
    }
    for (const [name, text] of Object.entries(BUILT_IN_PROMPTS)) {
      if (overrides.has(name)) continue
      overrides.set(name, {
        version: 0, name, text,
        revision: key('prompt-built-in', name), createdAt: '', builtIn: true,
      })
    }
    return [...overrides.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Save a new immutable version of one prompt.
   * @param name - built-in prompt name to override.
   * @param text - new prompt text.
   * @returns the stored version with its revision and timestamp.
   */
  savePrompt(name: string, text: string): PromptVersionView {
    if (!(name in BUILT_IN_PROMPTS)) throw new Error(`unknown prompt ${name}`)
    if (text.trim().length === 0) throw new Error(`prompt ${name} cannot be empty`)
    const stored = this.store.getSetting(PROMPT_KEY) as StoredPrompts | undefined
    const versions = [...stored?.versions ?? []]
    const highest = versions.reduce((max, version) => version.name === name ? Math.max(max, version.version) : max, 0)
    const version: PromptVersionView = {
      version: highest + 1,
      name,
      text,
      revision: key('prompt', name, highest + 1, text),
      createdAt: new Date().toISOString(),
      builtIn: false,
    }
    versions.push(version)
    this.store.setSetting(PROMPT_KEY, { versions } satisfies StoredPrompts)
    this.store.setSetting(`prompt.version.${name}.${version.version}`, version)
    return version
  }

  /**
   * Immutable history of one prompt, newest first.
   * @param name - prompt whose saved versions are listed.
   * @returns all stored versions, excluding the built-in text.
   */
  promptHistory(name: string): readonly PromptVersionView[] {
    const stored = this.store.getSetting(PROMPT_KEY) as StoredPrompts | undefined
    return (stored?.versions ?? []).filter(version => version.name === name).slice().sort((a, b) => b.version - a.version)
  }

  /**
   * Restore a prompt to its built-in text by saving a new version.
   * @param name - prompt to reset.
   * @returns the new version carrying the built-in text.
   */
  resetPrompt(name: string): PromptVersionView {
    const builtIn = BUILT_IN_PROMPTS[name]
    if (builtIn === undefined) throw new Error(`unknown prompt ${name}`)
    return this.savePrompt(name, builtIn)
  }
}
