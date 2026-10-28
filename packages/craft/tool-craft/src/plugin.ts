/**
 * Craft gateway plugin: exactly two model-facing tools stay mounted while no
 * app is active. Opening an app mounts its curated tool bridge and, only when
 * its registry matches a reviewed hash, its recipe skill; closing releases both.
 * @module @greeneek/gnk-tool-craft/plugin
 */

import type { Context } from '@greeneek/cordis'
import { CraftError } from '@greeneek/gnk-craft'
import type { CraftSession, CraftStatus } from '@greeneek/gnk-craft'
import type { ToolDefinition, ToolExecution } from '@greeneek/gnk-tools'
import type { JsonValue } from '@greeneek/gnk-util-values'
import { registerAppTools, registerRecipeSkill } from './bridge.ts'
import type { CraftAppBridge, CraftOpenMode, CraftOpenSummary } from './types.ts'

/** Gateway tool: list every pilot app and its measured state. */
export const CRAFT_LIST_APPS = 'craft_list_apps'
/** Gateway tool: open, attach (gated), or close one app. */
export const CRAFT_OPEN_APP = 'craft_open_app'

/** One active app session and everything mounted for it. */
interface ActiveApp {
  readonly app: string
  readonly displayName: string
  readonly session: CraftSession
  readonly tools: readonly string[]
  readonly disposers: readonly (() => void)[]
}

/** Parameters for the open gateway. */
interface OpenArguments {
  readonly app: string
  readonly mode: CraftOpenMode
}

/**
 * Mount the Craft gateway.
 * @param ctx - context carrying `craft`, `tools`, and `skills`.
 */
export function apply(ctx: Context): void {
  const active = new Map<string, ActiveApp>()

  const closeApp = async (app: string): Promise<boolean> => {
    const entry = active.get(app)
    if (entry === undefined) return false
    active.delete(app)
    for (const dispose of [...entry.disposers].reverse()) dispose()
    try {
      await entry.session.close()
    } catch (error: unknown) {
      ctx.logger.warn(`tool-craft: failed to close ${entry.displayName}: ${String(error)}`)
    }
    return true
  }

  const closeAll = async (): Promise<void> => {
    for (const app of [...active.keys()]) await closeApp(app)
  }

  // Registered before the gateway so session teardown runs after the tools
  // unregister (effects dispose in reverse registration order).
  ctx.effect(() => async () => {
    await closeAll()
  }, 'tool-craft.sessions')

  const openApp = async (args: OpenArguments, exec: ToolExecution): Promise<CraftOpenSummary> => {
    const manifest = ctx.craft.app(args.app)
    if (args.mode === 'close') {
      const closed = await closeApp(manifest.id)
      return {
        app: manifest.id,
        displayName: manifest.displayName,
        state: closed ? 'closed' : 'not-open',
      }
    }
    const existing = active.get(manifest.id)
    if (existing !== undefined) return summary(existing)
    const session = await ctx.craft.open({
      app: manifest.id,
      mode: args.mode,
      workspaceRoot: workspaceRoot(exec),
      signal: exec.signal,
    })
    let bridge: CraftAppBridge | undefined
    const disposers: Array<() => void> = []
    try {
      bridge = registerAppTools(ctx, session, manifest)
      disposers.push(...bridge.disposers)
      if (session.registryReviewed) disposers.push(registerRecipeSkill(ctx, manifest))
    } catch (error: unknown) {
      if (bridge !== undefined) {
        for (const dispose of [...bridge.disposers].reverse()) dispose()
      }
      await session.close().catch((closeError: unknown) => {
        ctx.logger.warn(`tool-craft: failed to close ${manifest.displayName} after a mount failure: ${String(closeError)}`)
      })
      throw error
    }
    const entry: ActiveApp = {
      app: manifest.id,
      displayName: manifest.displayName,
      session,
      tools: bridge.names,
      disposers,
    }
    active.set(manifest.id, entry)
    return summary(entry)
  }

  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(listDefinition(ctx)),
      ctx.tools.register(openDefinition(openApp)),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'tool-craft.gateway')
}

/**
 * Render the app list for the model.
 * @param value - gateway value carrying every measured status.
 * @returns one line per app, or a placeholder when none exist.
 */
export function renderAppList(value: { readonly apps: readonly CraftStatus[] }): string {
  const lines = value.apps.map(app =>
    `${app.displayName} (${app.app}): ${app.state}${app.detail === undefined ? '' : ` — ${app.detail}`}`)
  return lines.length === 0 ? 'No Craft apps are available.' : lines.join('\n')
}

/**
 * Render one open/close summary for the model.
 * @param result - gateway summary.
 * @returns the running or terminal state text.
 */
export function renderOpenSummary(result: CraftOpenSummary): string {
  if (result.state !== 'running') {
    return `${result.displayName} (${result.app}): ${result.state}`
  }
  return `${result.displayName} (${result.app}) is running. `
    + `Artifacts belong under ${result.artifactsRoot ?? '(unknown root)'}. `
    + `Mounted tools: ${(result.tools ?? []).join(', ') || 'none'}.`
}

/** Build the model-facing summary of one active app. */
function summary(entry: ActiveApp): CraftOpenSummary {
  return {
    app: entry.app,
    displayName: entry.displayName,
    state: 'running',
    tools: entry.tools,
    roots: entry.session.roots,
    artifactsRoot: entry.session.roots.write,
  }
}

/** Resolve the session workspace from the calling agent, then the process. */
function workspaceRoot(exec: ToolExecution): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

/** The `craft_list_apps` definition. */
function listDefinition(ctx: Context): ToolDefinition {
  return {
    name: CRAFT_LIST_APPS,
    description: 'List the Craft apps available in this build and their measured installation state. '
      + 'Call this before opening an app; opening an app is what mounts its tools.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {},
      render(_args: unknown, value: JsonValue): Array<{ type: 'text'; text: string }> {
        return [{ type: 'text', text: renderAppList(value as unknown as { apps: readonly CraftStatus[] }) }]
      },
    },
    async execute(_args: unknown, exec: ToolExecution): Promise<JsonValue> {
      const apps = await Promise.all(
        ctx.craft.listApps().map(manifest => ctx.craft.status(manifest.id, exec.signal)),
      )
      return { apps } as unknown as JsonValue
    },
  }
}

/** The `craft_open_app` definition. */
function openDefinition(
  openApp: (args: OpenArguments, exec: ToolExecution) => Promise<CraftOpenSummary>,
): ToolDefinition {
  return {
    name: CRAFT_OPEN_APP,
    description: 'Open one Craft app in headless mode and mount its curated tools, '
      + 'or close an app that is already running. Attach mode is refused unless the app manifest enables it.',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App id or alias, for example photocraft or pdfcraft.' },
        mode: {
          type: 'string',
          enum: ['headless', 'attach', 'close'],
          description: 'headless opens a job session, attach is gated, close releases a running app.',
        },
      },
      required: ['app'],
      additionalProperties: false,
    },
    output: {
      schema: {},
      render(_args: unknown, value: JsonValue): Array<{ type: 'text'; text: string }> {
        return [{ type: 'text', text: renderOpenSummary(value as unknown as CraftOpenSummary) }]
      },
    },
    async execute(args: unknown, exec: ToolExecution): Promise<JsonValue> {
      const parsed = parseOpenArguments(args)
      const result = await openApp(parsed, exec)
      return { ...result } as unknown as JsonValue
    },
  }
}

/**
 * Validate the gateway arguments. The tool registry does not reject extra
 * keys, so the gateway owns its own argument contract.
 * @param args - model arguments.
 * @returns the app id and mode.
 */
export function parseOpenArguments(args: unknown): OpenArguments {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new CraftError('craft_open_app requires an object with an "app" field', 'CRAFT_APP_NOT_IN_PILOT')
  }
  const record = args as Record<string, unknown>
  const app = record.app
  if (typeof app !== 'string' || app.trim() === '') {
    throw new CraftError('craft_open_app requires a non-empty "app" string', 'CRAFT_APP_NOT_IN_PILOT')
  }
  const mode = record.mode ?? 'headless'
  if (mode !== 'headless' && mode !== 'attach' && mode !== 'close') {
    throw new CraftError(`craft_open_app does not accept mode ${JSON.stringify(mode)}`, 'CRAFT_APP_NOT_IN_PILOT')
  }
  return { app, mode }
}
