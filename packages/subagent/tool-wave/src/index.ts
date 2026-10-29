/**
 * Lead-facing tool Consumer of the wave engine: `ctx.waves` reaches the model
 * as two tools. `wave_dispatch` fans out a one-shot fleet of one-shot
 * subagent members, waits for the whole wave to settle, and renders the
 * settled result — per-member status, token, and output rows plus diagnostics
 * and validated artifact pointers — in the model-facing payload. `wave_cancel`
 * cancels one retained wave by id, or every unsettled fleet of the calling
 * session, by way of the engine's parent-scoped views so no foreign wave is
 * ever addressed.
 *
 * Both tools mount inside one effect: a partial teardown can never leave the
 * cancel button registered without its dispatcher.
 *
 * @module @greeneek/gnk-tool-wave
 */

import type { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import { defineTool } from '@greeneek/gnk-tools'
import type { ToolDefinition } from '@greeneek/gnk-tools'
import { cancelWaveValue, renderCancelReport, renderWaveReport, waveReportValue } from './render.ts'
import type { WaveReport } from './render.ts'
import { cancelParameters, dispatchParameters, parseCancelArguments, parseDispatchArguments } from './arguments.ts'

export const name = 'tool-wave'

/** Both services are required before the fleet can mount. */
export const inject = ['tools', 'waves']

/** Plugin settings. */
export interface Config {
  /** Registry name of the `ctx.subagents` provider used when a member omits its own `provider`. */
  provider: string
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
})

/**
 * Mount the two fleet tools. The member provider default comes from the
 * plugin config; per-member overrides stay with the model.
 * @param ctx - context carrying `tools` and `waves`.
 * @param config - the default member provider.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(dispatchTool(ctx, config.provider)),
      ctx.tools.register(cancelTool(ctx)),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'tool-wave.fleet')
}

/** The `wave_dispatch` definition. */
function dispatchTool(ctx: Context, defaultProvider: string): ToolDefinition {
  return defineTool({
    name: 'wave_dispatch',
    description: 'Dispatch a wave: a fleet of one-shot subagents that runs concurrently until every member '
      + 'settles, and returns one report row per member — final output, status, tokens, child session id, and '
      + 'the engine-validated artifact pointers its structured result named. Each member does not see this '
      + 'conversation, so give every member a complete, standalone prompt, and give a member whose payload '
      + 'you need structured an `output_schema` (declare an `artifacts` array on it to have file paths and '
      + 'HTTP(S) URIs promoted to validated pointers). Use it to fan out independent work (research across '
      + 'several questions, parallel implementation, multi-reviewer checks) in one call instead of one '
      + 'delegation per subtask. A member that fails or exceeds its budget settles as a failed or '
      + 'budget-killed row; the wave still returns, with any token ceilings enforced by the engine.',
    parameters: dispatchParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          wave_id: { type: 'string', required: true },
          outcome: { type: 'string', required: true, enum: ['completed', 'partial', 'cancelled'] as const },
          rows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                member_id: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                role: { type: 'string' },
                model: { type: 'string' },
                status: { type: 'string', required: true },
                stop_reason: { type: 'string' },
                child_session_id: { type: 'string' },
                tokens_used: { type: 'integer', required: true },
                diagnostic: { type: 'string' },
                truncated: { type: 'boolean', required: true },
                output: { type: 'array', required: true, items: { type: 'json' } },
                structured: { type: 'json' },
                artifacts: { type: 'array', items: { type: 'json' } },
              },
            },
          },
        },
      },
      render: (_args, value) => renderWaveReport(value as WaveReport),
    },
    // A wave only appends its own member child sessions and the dispatching
    // session's wave records, so overlapping dispatches cannot corrupt each
    // other's report values.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers provide no Lead for wave ownership.
        throw new Error('wave_dispatch requires a calling agent (exec.agent was undefined)')
      }
      const request = parseDispatchArguments(args, defaultProvider)
      const result = await ctx.waves.startWave({ parent, ...request })
      return waveReportValue(result)
    },
  })
}

/** The `wave_cancel` definition. */
function cancelTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'wave_cancel',
    description: 'Cancel fleets this conversation started with wave_dispatch that are still running. With '
      + '`wave_id`, cancel exactly that retained wave; without it, emergency-stop every unsettled fleet of '
      + 'this conversation. Settled waves are left alone and reported as already settled, so calling this '
      + 'after a dispatch finished is always safe.',
    parameters: cancelParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          wave_id: { type: 'string' },
          rows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                wave_id: { type: 'string', required: true },
                outcome: { type: 'string', required: true, enum: ['cancelled', 'already settled'] as const },
              },
            },
          },
        },
      },
      render: (_args, value) => renderCancelReport(value),
    },
    // An abort delivery only flips member controller states and lets running
    // children observe their own signals; the session log writes stay with
    // each wave's own settlement funnel.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        throw new Error('wave_cancel requires a calling agent (exec.agent was undefined)')
      }
      const { wave_id } = parseCancelArguments(args)
      // The engine's cancelWave throws for an unknown id, so the tool scopes
      // cancel actions through the calling parent's retained views first;
      // an id the session never retained is a denial, not a registry error.
      const views = ctx.waves.listWaves(parent.session.id)
      return Promise.resolve(cancelWaveValue(views, wave_id, (target) => {
        ctx.waves.cancelWave(target)
      }))
    },
  })
}
