/**
 * Teammate-scoped tool guards: no member may move a lane's HEAD or publish a
 * ref, and a read-only lane may not mutate files. The shell guard is a
 * text-level refusal, not a security boundary — integration independently
 * verifies that the lane HEAD still equals its recorded base.
 * @module @greeneek/gnk-tool-agent-team/lane-guard
 */

import type { ToolExecution, ToolGuard } from '@greeneek/gnk-tools'
import type { LanePolicy } from '@greeneek/gnk-agent-team'

/** Shell tools whose `command` argument can reach git. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh'])

/** File and self-modification tools denied in a read-only lane. */
const READ_ONLY_DENIED: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'str_replace_editor',
  'notebook_edit',
  'cordis_define',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine',
])

/** Git subcommands that create commits or move refs by themselves. */
const FORBIDDEN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'am',
  'cherry-pick',
  'commit',
  'filter-branch',
  'gc',
  'maintenance',
  'merge',
  'notes',
  'pack-refs',
  'push',
  'rebase',
  'replace',
  'reset',
  'revert',
  'stash',
  'switch',
  'symbolic-ref',
  'tag',
  'update-ref',
  'worktree',
])

/** Git global options whose next token is a value rather than a subcommand. */
const GIT_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree',
])

/**
 * Decide whether one teammate tool call must be denied.
 * @param exec - the exact tool execution being guarded.
 * @param policy - the teammate's durable lane policy.
 * @returns a model-facing refusal, or undefined to dispatch.
 */
export function laneGuardViolation(exec: ToolExecution, policy: LanePolicy): string | undefined {
  if (policy.kind === 'read-only' && READ_ONLY_DENIED.has(exec.name)) {
    return `This teammate lane is read-only, so \`${exec.name}\` is not available.`
  }
  if (!SHELL_TOOLS.has(exec.name)) return undefined
  const command = commandArgument(exec.arguments)
  if (command === undefined) return undefined
  const mutation = gitMutation(command)
  if (mutation === undefined) return undefined
  return `Teammates cannot run \`git ${mutation}\`; the Team Lead reviews and integrates lane patches.`
}

/**
 * Install the teammate guard in one Agent scope.
 * @param agent - exact live teammate.
 * @param policy - resolves the teammate's immutable durable lane policy.
 * @returns the exact guard disposer.
 */
export function installLaneGuard(
  agent: { readonly ctx: { readonly tools: { guard(guard: ToolGuard): () => void } } },
  policy: () => LanePolicy,
): () => void {
  return agent.ctx.tools.guard(exec => laneGuardViolation(exec, policy()))
}

/**
 * Read the `command` field of a shell tool's parsed arguments.
 * @param args - frozen tool arguments.
 * @returns the command text, or undefined for a non-shell shape.
 */
function commandArgument(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  const command = (args as { readonly command?: unknown }).command
  return typeof command === 'string' ? command : undefined
}

/**
 * Find one forbidden Git invocation in a shell command. Tokens are split on
 * shell separators and whitespace while quotes protect embedded separators;
 * this catches ordinary invocations and leaves deliberate obfuscation to the
 * integration-time HEAD check.
 * @param command - complete shell command text.
 * @returns the forbidden subcommand, or undefined when none is found.
 */
export function gitMutation(command: string): string | undefined {
  for (const segment of command.split(/[;&|\n()]/u)) {
    // A quoted `sh -c "git commit"` keeps the nested command in one token;
    // splitting its whitespace lets the same scan see the nested invocation.
    const tokens = tokensOf(segment).flatMap(token => /\s/u.test(token) ? token.split(/\s+/u) : [token])
    for (let index = 0; index < tokens.length; index += 1) {
      const candidate = tokens[index]
      if (candidate === undefined || !isGit(candidate)) continue
      let cursor = index + 1
      while (cursor < tokens.length) {
        const token = tokens[cursor]
        if (token === undefined) break
        if (token.startsWith('-')) {
          cursor += GIT_OPTIONS_WITH_VALUE.has(token) ? 2 : 1
          continue
        }
        break
      }
      const subcommand = tokens[cursor]
      if (subcommand === undefined) continue
      if (FORBIDDEN_SUBCOMMANDS.has(subcommand)) return subcommand
      if (subcommand === 'branch' || subcommand === 'checkout') {
        const rest = tokens.slice(cursor + 1)
        if (subcommand === 'checkout' || rest.some(token => isBranchMutationFlag(token))) return subcommand
      }
    }
  }
  return undefined
}

/** Whether one token names a git executable. */
function isGit(token: string): boolean {
  return /(?:^|[/\\])git(?:\.exe)?$/u.test(token)
}

/** Whether a `git branch` flag changes, moves, or deletes a ref. */
function isBranchMutationFlag(token: string): boolean {
  return token === '-d'
    || token === '-D'
    || token === '-m'
    || token === '-M'
    || token === '-c'
    || token === '-C'
    || token === '-f'
    || token === '--delete'
    || token === '--move'
    || token === '--copy'
    || token === '--force'
}

/**
 * Split one shell segment into words, honoring single and double quotes.
 * @param segment - text between shell separators.
 * @returns unquoted tokens; an unclosed quote leaves the rest as one token.
 */
function tokensOf(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (const character of segment) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/u.test(character)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}
