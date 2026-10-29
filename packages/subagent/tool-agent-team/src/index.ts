/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type { Agent, AgentOptions } from '@greeneek/gnk-agent'
import { TeamError, TeamTaskId } from '@greeneek/gnk-agent-team'
import type { SpawnTeammateRequest, TeamMemberView } from '@greeneek/gnk-agent-team'
import { resolveLanePolicy } from '@greeneek/gnk-agent-team'
import { defineTool } from '@greeneek/gnk-tools'
import type { InferValue, ValueSchemaSpec } from '@greeneek/gnk-tools'
import type {} from '@greeneek/gnk-user-approval'
import { installLaneGuard } from './lane-guard.ts'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt']

/** Tool routing configuration. */
export interface Config {
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
})

/** Model-facing collaboration guidance shared by Lead and teammates. */
const POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

Teammates share the Lead checkout unless spawn_teammate declares write_scopes, which creates an isolated worktree lane. Write scopes of active isolated lanes must be disjoint; a read-only lane denies file and Git mutations. Teammates cannot commit, merge, push, tag, or move refs. The Lead checkpoints a lane, reviews its patch hash, then calls integrate_lane against a clean primary checkout; that runs the gates, commits, and removes the merged checkout. A conflict or gate failure halts the queue until the Lead investigates and resumes it. Ordinary shared edits are immediately visible to every member, so split shared write work into disjoint scopes and use task dependencies when work must be ordered.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

send_message steers a running target at its nearest step boundary, starts an idle target, and cold-resumes an inactive teammate. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/**
 * One roster row, matching `TeamMemberView`. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'idle', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const FLEET_MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    preset: { type: 'string' },
    model: { type: 'string' },
    reasoning_effort: { type: 'string' },
    read_only: { type: 'boolean' },
    write_scopes: { type: 'array', items: { type: 'string' } },
    max_tokens: { type: 'integer' },
  },
} as const

const FLEET_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    members: { type: 'array', required: true, items: MEMBER_VIEW_SCHEMA },
  },
} as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['accepted', 'queued'] },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const LANE_CHECKPOINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hash: { type: 'string', required: true },
    path: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    at: { type: 'integer', required: true },
  },
} as const

const LANE_MERGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lane: { type: 'string', required: true },
    patchHash: { type: 'string', required: true },
    primaryHead: { type: 'string', required: true },
    gates: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          argv: { type: 'array', required: true, items: { type: 'string' } },
          output: { type: 'string', required: true },
        },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'idle', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/**
 * Build the optional child route override from one spawn request.
 * @param args - model and reasoning-effort fields from the tool call.
 * @returns child agent options, or undefined when both are omitted.
 */
function agentOptionsOf(args: { readonly model?: string; readonly reasoning_effort?: string }): AgentOptions | undefined {
  if (args.model === undefined && args.reasoning_effort === undefined) return undefined
  return {
    ...args.model === undefined ? {} : { model: args.model },
    ...args.reasoning_effort === undefined
      ? {}
      : { reasoningEffort: args.reasoning_effort as NonNullable<AgentOptions['reasoningEffort']> },
  }
}

/** One member field set accepted by the fleet tool. */
interface FleetMemberArgs {
  readonly name: string
  readonly description: string
  readonly prompt: string
  readonly context?: 'fresh' | 'fork'
  readonly preset?: string
  readonly model?: string
  readonly reasoning_effort?: string
  readonly read_only?: boolean
  readonly write_scopes?: readonly string[]
  readonly max_tokens?: number
}

/** One admitted fleet proposal; the loop adds the caller cancellation. */
type FleetProposal = Omit<SpawnTeammateRequest, 'signal'>

const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Validate and normalize every member before the approval card is shown, so a
 * rejection never happens after the user already consented to a partial fleet.
 * @param members - member field sets from the tool call.
 * @param config - configured in-process provider names.
 * @returns admitted proposals in request order.
 */
function fleetProposals(members: readonly FleetMemberArgs[], config: Required<Config>): FleetProposal[] {
  if (members.length === 0) {
    throw new TeamError('a fleet needs at least one member', 'TEAM_INVALID_ARGUMENT')
  }
  const names = new Set<string>()
  return members.map((member) => {
    if (!MEMBER_NAME.test(member.name) || member.name.length > 64 || member.name === 'lead') {
      throw new TeamError(
        `fleet member name ${JSON.stringify(member.name)} must be lower-kebab-case, at most 64 characters, and not "lead"`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    if (names.has(member.name)) {
      throw new TeamError(`duplicate fleet member name "${member.name}"`, 'TEAM_INVALID_ARGUMENT')
    }
    names.add(member.name)
    if (member.max_tokens !== undefined && (!Number.isSafeInteger(member.max_tokens) || member.max_tokens < 1)) {
      throw new TeamError(`fleet member "${member.name}" max_tokens must be a positive safe integer`, 'TEAM_INVALID_ARGUMENT')
    }
    resolveLanePolicy({
      ...member.read_only === undefined ? {} : { readOnly: member.read_only },
      ...member.write_scopes === undefined ? {} : { writeScopes: member.write_scopes },
    })
    const context = member.context ?? 'fresh'
    const agentOptions = agentOptionsOf(member)
    return {
      name: member.name,
      description: member.description,
      prompt: [{ type: 'text' as const, text: member.prompt }],
      context,
      provider: context === 'fork' ? config.forkProvider : config.freshProvider,
      ...member.preset === undefined ? {} : { agentPreset: member.preset },
      ...agentOptions === undefined ? {} : { agentOptions },
      ...member.read_only === undefined ? {} : { readOnly: member.read_only },
      ...member.write_scopes === undefined ? {} : { writeScopes: member.write_scopes },
      ...member.max_tokens === undefined ? {} : { maxTokens: member.max_tokens },
    }
  })
}

/**
 * Build the confirmation-card text: every member's provider, composition,
 * effort, token budget, and write capability, plus the zero-spend outcome of
 * declining.
 * @param label - optional fleet label.
 * @param proposals - normalized member proposals.
 * @returns one multi-line approval reason.
 */
function fleetApprovalReason(label: string | undefined, proposals: readonly FleetProposal[]): string {
  const heading = label === undefined || label.trim().length === 0
    ? 'Fleet launch confirmation'
    : `Fleet "${label.trim()}" launch confirmation`
  const rows = proposals.map((proposal, index) => {
    const lane = proposal.readOnly === true
      ? 'read-only'
      : proposal.writeScopes === undefined
        ? 'shared checkout, no declared write scope'
        : `isolated worktree, write scopes ${proposal.writeScopes.join(', ')}`
    return `${String(index + 1)}. ${proposal.name} — provider=${proposal.provider}, context=${proposal.context},`
      + ` preset=${proposal.agentPreset ?? 'inherited'}, model=${proposal.agentOptions?.model ?? 'inherited'},`
      + ` effort=${proposal.agentOptions?.reasoningEffort ?? 'inherited'},`
      + ` budget=${proposal.maxTokens === undefined ? 'unbounded' : `${proposal.maxTokens} tokens`}; ${lane}`
  })
  return `${heading}\n\n${rows.join('\n')}\n\nApproving launches ${proposals.length} teammate(s) and creates only the isolated worktrees listed above. Rejecting, cancelling, or timing out creates no children and no worktrees.`
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: () => {
        const membership = ctx.agentTeams.membership(agent)
        return `${POLICY}\n\nYour Team role is ${membership.role}; your Team name is ${membership.name}; Team id is ${membership.id}.`
      },
    }))

    const membership = ctx.agentTeams.membership(agent)
    if (membership.role === 'teammate') {
      register(installLaneGuard(agent, () => ctx.agentTeams.lanePolicyFor(agent)))
    }

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case teammate name.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        preset: {
          type: 'string',
          description: 'Agent preset the lane composes from (for example standard or instructor); omitted inherits the Lead composition.',
        },
        cwd: {
          type: 'string',
          description: 'Absolute lane checkout the teammate runs in; omitted inherits the Lead working directory.',
        },
        read_only: {
          type: 'boolean',
          description: 'Run the teammate without file-mutating or Git-mutating tools. Cannot be combined with write_scopes.',
        },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Workspace-relative paths the teammate may change. Creates an isolated worktree lane with a disjoint scope set; the Lead integrates its patch.',
        },
        model: { type: 'string', description: 'Model id override; omitted inherits the Lead request route.' },
        reasoning_effort: { type: 'string', description: 'Adapter-owned reasoning effort override.' },
        max_tokens: { type: 'integer', description: 'Cumulative token ceiling checked at each step boundary; requires the tokenUsage projection.' },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const agentOptions = agentOptionsOf(args)
        return await ctx.agentTeams.spawnTeammate(agent, {
          name: args.name,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          ...args.preset !== undefined ? { agentPreset: args.preset } : {},
          ...agentOptions === undefined ? {} : { agentOptions },
          ...args.cwd !== undefined ? { cwd: args.cwd } : {},
          ...args.read_only !== undefined ? { readOnly: args.read_only } : {},
          ...args.write_scopes !== undefined ? { writeScopes: args.write_scopes } : {},
          ...args.max_tokens !== undefined ? { maxTokens: args.max_tokens } : {},
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'spawn_fleet',
      description: 'Create several teammates after one explicit user approval card. The card lists every member, preset, model, reasoning effort, token budget, provider, and write capability; a rejection, cancellation, or timeout creates no child and no worktree.',
      parameters: {
        label: { type: 'string', description: 'Short display label for the fleet.' },
        members: { type: 'array', required: true, items: FLEET_MEMBER_SCHEMA },
      },
      output: jsonOutput(FLEET_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_fleet')
        const proposals = fleetProposals(args.members, config)
        const approval = ctx.get('approval')
        if (approval === undefined) {
          throw new TeamError(
            'fleet launch needs the approval capability to show its confirmation card',
            'FLEET_APPROVAL_UNAVAILABLE',
          )
        }
        const outcome = await approval.request({
          agent,
          toolName: 'spawn_fleet',
          callId: exec.callId,
          reason: fleetApprovalReason(args.label, proposals),
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          throw new TeamError(
            `fleet launch ${outcome}; no teammate or lane was created`,
            'FLEET_NOT_APPROVED',
          )
        }
        const created: TeamMemberView[] = []
        for (const proposal of proposals) {
          try {
            created.push((await ctx.agentTeams.spawnTeammate(agent, { ...proposal, signal: exec.signal })).member)
          } catch (error: unknown) {
            throw new TeamError(
              `fleet stopped after ${created.length} of ${proposals.length} members: ${error instanceof Error ? error.message : String(error)}`,
              'FLEET_LAUNCH_FAILED',
              { cause: error },
            )
          }
        }
        return { members: created }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'checkpoint_lane',
      description: 'Stage and store the exact patch of one isolated lane. Only the Team Lead may call this tool. The hash is the reviewed patch identity integrate_lane requires.',
      parameters: {
        lane: { type: 'string', required: true, description: 'Lane name, which is also the teammate name.' },
      },
      output: jsonOutput(LANE_CHECKPOINT_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.checkpointLane(
          callingAgent(exec.agent, 'checkpoint_lane'),
          args.lane,
          exec.signal,
        )
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'discard_lane',
      description: 'Checkpoint then remove one isolated lane checkout and branch. Only the Team Lead may call this tool; the checkpointed patch stays as evidence.',
      parameters: {
        lane: { type: 'string', required: true, description: 'Lane name, which is also the teammate name.' },
      },
      output: jsonOutput(LANE_CHECKPOINT_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.discardLane(
          callingAgent(exec.agent, 'discard_lane'),
          args.lane,
          exec.signal,
        )
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'integrate_lane',
      description: 'Apply one reviewed lane patch to a clean primary checkout, run the supplied gates, commit, and remove the merged checkout. Only the Team Lead may call this tool. The queue stops after the first conflict or gate failure.',
      parameters: {
        lane: { type: 'string', required: true, description: 'Lane name.' },
        expected_primary_head: { type: 'string', required: true, description: 'Primary HEAD commit the reviewers approved.' },
        patch_hash: { type: 'string', required: true, description: 'Exact hash returned by checkpoint_lane after review.' },
        gate_commands: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Gate argv arrays, each run in the primary checkout after the patch applies.',
        },
        commit_message: { type: 'string', required: true, description: 'Commit message for the integration commit.' },
      },
      output: jsonOutput(LANE_MERGE_SCHEMA),
      async execute(args, exec) {
        const merged = await ctx.agentTeams.integrateLane(callingAgent(exec.agent, 'integrate_lane'), {
          lane: args.lane,
          expectedPrimaryHead: args.expected_primary_head,
          patchHash: args.patch_hash,
          gateCommands: (args.gate_commands ?? []).map(argv => ({ argv })),
          commitMessage: args.commit_message,
          signal: exec.signal,
        })
        return {
          ...merged,
          gates: merged.gates.map(gate => ({ argv: [...gate.argv], output: gate.output })),
        }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one durable message to another Team member. A running target receives it at the nearest step boundary; an idle target starts a turn; an inactive teammate cold-resumes.',
      parameters: {
        target: { type: 'string', required: true, description: 'Team member name, or lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      execute(args, exec) {
        return ctx.agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with current runtime status.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      async execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, mailbox, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'interrupt_agent',
      description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate name.' },
      },
      output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.interrupt(
          callingAgent(exec.agent, 'interrupt_agent'),
          args.target,
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member-name filter; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member name for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
}
