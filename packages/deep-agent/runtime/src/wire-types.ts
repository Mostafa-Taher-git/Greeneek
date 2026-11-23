/** Browser-safe Deep-agent settings and prompt wire types. */

/** Wire-safe policy rule. */
export interface RuleView {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly instruction: string
}

/** Wire-safe source policy row. */
export interface SourcePolicyView {
  readonly allowed: readonly { readonly id: string; readonly name?: string }[]
  readonly admission: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** The full editable settings document. */
export interface SettingsView {
  readonly revision: number
  readonly paused: boolean
  readonly rules: readonly RuleView[]
  readonly mode: 'off' | 'observe' | 'auto'
  readonly evalTimeoutSeconds: number
  readonly maxWorkers: number
  readonly workerDirectory: string
  readonly prepareCommand: string
  readonly blockedCommands: readonly string[]
  readonly sources: Readonly<Record<string, SourcePolicyView>>
}

/** Wire-safe settings save payload; only known fields can cross the Remote. */
export interface SettingsSaveValue {
  readonly rules?: readonly RuleView[]
  readonly mode?: 'off' | 'observe' | 'auto'
  readonly evalTimeoutSeconds?: number
  readonly maxWorkers?: number
  readonly workerDirectory?: string
  readonly prepareCommand?: string
  readonly blockedCommands?: readonly string[]
  readonly sources?: Readonly<Record<string, SourcePolicyView>>
  readonly paused?: boolean
}

/** One immutable prompt version. */
export interface PromptVersionView {
  readonly version: number
  readonly name: string
  readonly text: string
  readonly revision: string
  readonly createdAt: string
  readonly builtIn: boolean
}
