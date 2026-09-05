/** Shared projection of the live LLM registry into the browser model catalog. */

import type { Context } from '@greeneek/cordis'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a
 * model. Resolved rather than merely read, so a deployment that pins no
 * provider still reports the route the user's own key activated; `null` only
 * when nothing can serve a request yet, which the browser renders as the empty
 * first-run state rather than as a selection it cannot serve.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection?: ModelSelection  ,
): Promise<ModelCatalog> {
  const selection = defaultSelection ?? await ctx.agentDefaultModel.resolveSelection()
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  return {
    default: selection === undefined ? null : { ...selection },
    routableProviders: providers.map(provider => provider.id),
    groups: catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
      // Visibility is a selector concern, not a routing one: hidden models
      // stay resolvable, they simply stop being offered. A hidden id naming
      // no listed model changes nothing, so stale entries never error.
      .map((group) => {
        const hidden = new Set(ctx.llm.hiddenModels(group.id))
        return { ...group, models: group.models.filter(model => !hidden.has(model.id)) }
      })
      .filter(group => group.models.length > 0),
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}
