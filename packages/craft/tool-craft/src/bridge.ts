/**
 * Per-app tool bridge: a curated slice of the app's advertised catalog is
 * registered under the shared `mcp__<app>__<tool>` naming contract, so the
 * gateway turn cost stays at two schemas until an app is opened.
 * @module @greeneek/gnk-tool-craft/bridge
 */

import type { Context } from '@greeneek/cordis'
import { matchesToolFilter, publicToolName } from '@greeneek/gnk-mcp-client'
import { CraftError } from '@greeneek/gnk-craft'
import type { CraftAppManifest, CraftRecipe, CraftSession, CraftToolDescriptor } from '@greeneek/gnk-craft'
import type { ToolDefinition, ToolExecution } from '@greeneek/gnk-tools'
import type { JsonValue } from '@greeneek/gnk-util-values'
// Side-effect type import: declaration-merges `ctx.skills` onto Context.
import type {} from '@greeneek/gnk-skill'
import { projectCallResult } from './artifacts.ts'
import type { CraftAppBridge } from './types.ts'

/** Canonical value returned by one bridged app tool. */
interface BridgedValue {
  readonly text: string
  readonly artifacts: readonly string[]
}

/**
 * Register the manifest-filtered subset of an app's tools.
 * @param ctx - context carrying `tools`.
 * @param session - live headless session.
 * @param manifest - app manifest supplying the filter.
 * @returns the registered names and their disposers.
 */
export function registerAppTools(
  ctx: Context,
  session: CraftSession,
  manifest: CraftAppManifest,
): CraftAppBridge {
  const names: string[] = []
  const disposers: Array<() => void> = []
  try {
    for (const tool of session.tools) {
      if (!matchesToolFilter(manifest.headless.toolFilter, tool.name)) continue
      const name = publicToolName(manifest.id, tool.name)
      disposers.push(ctx.tools.register(bridgedDefinition(name, tool, session, manifest)))
      names.push(name)
    }
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return { names, disposers }
}

/**
 * Register one app's recipe as a runtime skill while the app is active.
 * @param ctx - context carrying `craft` and `skills`.
 * @param manifest - app manifest.
 * @returns the skill's unregister disposer.
 */
export function registerRecipeSkill(ctx: Context, manifest: CraftAppManifest): () => void {
  const recipe: CraftRecipe = ctx.craft.recipe(manifest.id)
  return ctx.skills.register({
    name: recipe.name,
    description: recipe.description,
    content: recipe.content,
    source: 'runtime',
  })
}

/**
 * Build one bridged tool definition.
 * @param name - public registry name.
 * @param tool - advertised descriptor.
 * @param session - owning session (transport and roots).
 * @param manifest - app manifest for display text.
 * @returns the tool definition.
 */
function bridgedDefinition(
  name: string,
  tool: CraftToolDescriptor,
  session: CraftSession,
  manifest: CraftAppManifest,
): ToolDefinition {
  return {
    name,
    description: tool.description === ''
      ? `Run ${tool.name} in ${manifest.displayName}`
      : `${tool.description} (${manifest.displayName})`,
    parameters: tool.inputSchema,
    output: {
      schema: {},
      render(_args: unknown, value: JsonValue): Array<{ type: 'text'; text: string }> {
        const projected = value as unknown as BridgedValue
        return [{ type: 'text', text: projected.text }]
      },
    },
    async execute(args: unknown, exec: ToolExecution): Promise<JsonValue> {
      const argsObject = typeof args === 'object' && args !== null && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {}
      const result = await session.transport.callTool(tool.name, argsObject, { signal: exec.signal })
      const projected = projectCallResult(result, session.roots)
      if (result.isError === true) {
        throw new CraftError(
          `${manifest.displayName} reported "${tool.name}" as failed: ${projected.text}`,
          'CRAFT_APP_ERROR',
        )
      }
      return { text: projected.text, artifacts: [...projected.artifacts] }
    },
  }
}
