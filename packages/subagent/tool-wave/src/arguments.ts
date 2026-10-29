/**
 * Tool-owned argument contracts for the wave tools: the compact parameter DSL
 * schemas plus the checks the registry schema cannot express — undeclared
 * top-level arguments, wave-size bounds, and token-budget sanity.
 *
 * The registry parameter root stays open by design, so the tools reject keys
 * outside their declared arguments themselves; member objects are closed
 * (`additionalProperties: false`) and their per-member shape failure already
 * surfaces as a registry `ToolArgsError`.
 *
 * @module @greeneek/gnk-tool-wave/arguments
 */

import { ToolArgsError } from '@greeneek/gnk-tools'
import { assertObjectJsonSchema, JsonSchemaError } from '@greeneek/gnk-tools'
import type { InferArgs, ObjectJsonSchema, ParameterSchemaSpec } from '@greeneek/gnk-tools'
import type { AgentOptions } from '@greeneek/gnk-agent'
import { ReasoningEffortId } from '@greeneek/gnk-llm'
import type { WaveMemberSpec, WaveRequest } from '@greeneek/gnk-subagent-wave'

/** Hard cap on one fleet's member count; the engine owns launch concurrency separately. */
export const MAX_MEMBERS = 16

/** Parameters of `wave_dispatch`. */
export const dispatchParameters = {
  label: {
    type: 'string',
    required: true,
    description: 'Short fleet label kept in this session\'s wave records.',
  },
  members: {
    type: 'array',
    required: true,
    description: 'The fleet: one one-shot subagent per entry, launched concurrently and reported in this order.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Complete, standalone task for this member; members do not share this conversation.',
        },
        role: {
          type: 'string',
          description: 'Display role for this member (for example "reviewer"), kept beside its result row.',
        },
        provider: {
          type: 'string',
          description: 'Subagent provider for this member, overriding the configured default provider.',
        },
        model: {
          type: 'string',
          description: 'Model id pinned for this member, interpreted by its provider.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Reasoning effort for this member when the effective provider route supports one.',
        },
        output_schema: {
          type: 'json',
          description: 'Object-rooted JSON Schema this member\'s final answer must satisfy; a valid answer '
            + 'returns as the row\'s `structured` value. Declare an `artifacts` array of '
            + '`{"kind":"file","path":"…"}` or `{"kind":"uri","uri":"https://…"}` entries to have the '
            + 'engine promote validated artifact pointers onto the row.',
        },
      },
    },
  },
  on_complete: {
    type: 'string',
    enum: ['continue-others', 'fail-fast'] as const,
    description: 'What a failed or budget-killed member does to its siblings: `continue-others` (default) lets '
      + 'them finish; `fail-fast` cancels every remaining active member.',
  },
  max_tokens_per_member: {
    type: 'integer',
    description: 'Token ceiling per member; a member exceeding it is killed at its next step boundary. '
      + 'Omit for no per-member ceiling.',
  },
  max_wave_tokens: {
    type: 'integer',
    description: 'Token ceiling across the whole fleet; breaching it kills every active member. Omit for no fleet ceiling.',
  },
} satisfies ParameterSchemaSpec

/** The model arguments of `wave_dispatch` after registry validation. */
export type DispatchArguments = InferArgs<typeof dispatchParameters>

/** One registry-validated member entry. */
export type DispatchMember = DispatchArguments['members'][number]

/** The engine request body of a validated dispatch, minus the engine-owned Lead parent. */
export type DispatchRequest = Omit<WaveRequest, 'parent'>

/** Parameters of `wave_cancel`. */
export const cancelParameters = {
  wave_id: {
    type: 'string',
    description: 'Cancel exactly the retained wave with this id; omit it to cancel every unsettled fleet '
      + 'dispatched from this conversation.',
  },
} satisfies ParameterSchemaSpec

/** The model arguments of `wave_cancel` after registry validation. */
export type CancelArguments = InferArgs<typeof cancelParameters>

/**
 * Collect the argument names the registry schema cannot express as violations.
 * @param args - validated model arguments.
 * @param accepted - the declared top-level keys of the calling tool.
 * @returns one violation per undeclared key.
 */
function unknownKeyViolations(args: Record<string, unknown>, accepted: readonly string[]): string[] {
  return Object.keys(args)
    .filter(key => !accepted.includes(key))
    .map(key => `${key} is not an accepted argument for this wave tool`)
}

/**
 * Map one member entry onto its engine spec. The configured provider is the
 * default; a member's own `provider` wins — every other engine-owned field
 * (`parent`, signal, admission) stays with the wave engine.
 * @param member - the validated member entry.
 * @param defaultProvider - the plugin config's provider name.
 * @param outputSchema - the member's output schema after
 *   {@link parseDispatchArguments} asserted it against the enforced subset;
 *   `undefined` when the entry carried none.
 * @returns the engine member spec.
 */
export function memberSpec(
  member: DispatchMember,
  defaultProvider: string,
  outputSchema?: ObjectJsonSchema,
): WaveMemberSpec {
  const agentOptions = memberAgentOptions(member)
  return {
    provider: member.provider ?? defaultProvider,
    ...(member.role === undefined ? {} : { role: member.role }),
    request: {
      prompt: [{ type: 'text', text: member.prompt }],
      ...(agentOptions === undefined ? {} : { agentOptions }),
      ...(outputSchema === undefined ? {} : { outputSchema }),
    },
  }
}

/**
 * Resolve one member's optional child LLM route into `agentOptions`.
 * @param member - the validated member entry.
 * @returns the route, or `undefined` when the member pins neither `model` nor `reasoning_effort`.
 */
function memberAgentOptions(member: DispatchMember): AgentOptions | undefined {
  if (member.model === undefined && member.reasoning_effort === undefined) return undefined
  return {
    ...(member.model === undefined ? {} : { model: member.model }),
    ...(member.reasoning_effort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(member.reasoning_effort) }),
  }
}

/**
 * Validate the dispatch arguments beyond what the DSL schema can express and
 * build the engine request body. The registry already rejected shape errors —
 * missing member prompts, wrong member keys, non-integer budgets — so only
 * size, set-membership, and budget-sanity remain here, and every violation is
 * collected into one `ToolArgsError`.
 * @param args - validated model arguments.
 * @param defaultProvider - the plugin config's provider name.
 * @returns the engine request body minus the engine-owned Lead parent.
 * @throws {@link ToolArgsError} with every bounds violation.
 */
export function parseDispatchArguments(args: DispatchArguments, defaultProvider: string): DispatchRequest {
  const violations = unknownKeyViolations(
    args,
    ['label', 'members', 'on_complete', 'max_tokens_per_member', 'max_wave_tokens'],
  )
  if (args.members.length === 0) violations.push('a wave requires at least one member')
  if (args.members.length > MAX_MEMBERS) violations.push(`a wave carries at most ${MAX_MEMBERS} members`)
  for (const [index, member] of args.members.entries()) {
    if (member.output_schema === undefined) continue
    try {
      assertObjectJsonSchema(member.output_schema)
    } catch (error: unknown) {
      // The schema error's own violation list is the diagnostic a model can
      // act on; its wrapper prefix would only restate it.
      const detail = error instanceof JsonSchemaError
        ? error.violations.join('; ')
        : error instanceof Error ? error.message : String(error)
      violations.push(`members[${index}].output_schema: ${detail}`)
    }
  }
  for (const [key, value] of [
    ['max_tokens_per_member', args.max_tokens_per_member],
    ['max_wave_tokens', args.max_wave_tokens],
  ] as const) {
    if (value === undefined) continue
    if (value <= 0) violations.push(`${key} must be a positive token budget`)
    else if (!Number.isSafeInteger(value)) violations.push(`${key} must be a safe integer token budget`)
  }
  if (violations.length > 0) throw new ToolArgsError(violations)
  return {
    label: args.label,
    members: args.members.map(entry => memberSpec(
      entry,
      defaultProvider,
      // Every entry's schema was asserted above, so a surviving value is a
      // schema the subagent seam accepts; the raw JSON value type just has no
      // overlapping structural face with the schema type.
      entry.output_schema === undefined ? undefined : entry.output_schema as unknown as ObjectJsonSchema,
    )),
    ...(args.on_complete === undefined ? {} : { onComplete: args.on_complete }),
    ...(args.max_tokens_per_member === undefined ? {} : { maxTokensPerMember: args.max_tokens_per_member }),
    ...(args.max_wave_tokens === undefined ? {} : { maxWaveTokens: args.max_wave_tokens }),
  }
}

/**
 * Validate the cancel arguments beyond what the DSL schema can express. The
 * registry root is open, so undeclared keys need this tool-owned guard; the
 * `wave_id` value itself is validated by the report, not by a throw — an id
 * this session never retained is a denial rendered back to the model, not an
 * argument error.
 * @param args - validated model arguments.
 * @returns the addressed wave id, when present.
 * @throws {@link ToolArgsError} on any undeclared argument.
 */
export function parseCancelArguments(args: CancelArguments): { readonly wave_id: string | undefined } {
  const violations = unknownKeyViolations(args, ['wave_id'])
  if (violations.length > 0) throw new ToolArgsError(violations)
  return { wave_id: args.wave_id }
}
