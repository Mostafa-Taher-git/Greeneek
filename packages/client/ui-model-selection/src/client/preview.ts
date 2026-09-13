/**
 * Preview-model projection: the presentational shape the selector panel
 * renders, decoupled from the session directory so the panel stays a pure
 * props-driven component (like a pasted UI kit piece) while Greeneek feeds
 * it live catalog data through `directoryPreviewModels`.
 */
import type {
  ModelProviderGroup, ModelReasoning,
} from '@greeneek/gnk-api-session-controller/types'

/**
 * Effort ids that are never offered as selectable rows, even when a Host
 * declares them: `off` disables reasoning, `minimal` sits below the
 * scale's Low floor, and `ultra` is a wire spelling of Max (the provider
 * adapter sends it for the canonical max level), never a level itself.
 */
export const NON_OFFERED_EFFORT_IDS: ReadonlySet<string> = new Set(['off', 'minimal', 'ultra'])

/** Canonical power-scale order; Max closes the scale. */
const EFFORT_RANK: Record<string, number> = {
  low: 0, medium: 1, high: 2, xhigh: 3, 'extra-high': 3, max: 4,
}

/**
 * Rank one effort id for display order. Provider-specific ids the scale
 * does not know sit in the unranked zone just below Max (keeping their
 * declaration order there — sort is stable): nothing offered may outrank
 * Max, and no invented magnitude is assigned to levels we cannot verify.
 */
export function effortRank(id: string): number {
  return EFFORT_RANK[id.toLowerCase()] ?? 3.5
}

/** Whether the Host-declared id is offered as a selectable level. */
export function isOfferedEffort(id: string): boolean {
  return !NON_OFFERED_EFFORT_IDS.has(id.toLowerCase())
}

/** Order two effort ids: canonical scale first, Max always last. */
export function compareEffortIds(a: string, b: string): number {
  return effortRank(a) - effortRank(b)
}

/** One reasoning level offered for a preview model. */
export interface PreviewEffort {
  readonly id: string
  readonly name: string
}

/** Optional 1–10 metric bars; omitted models render no bars (never invented). */
export interface PreviewModelMetrics {
  readonly intelligence: number
  readonly speed: number
  readonly context: number
  readonly cost: number
}

/** One model row with everything the detail panel needs. */
export interface PreviewModel {
  /** Opaque row key, unique across providers. */
  readonly value: string
  readonly label: string
  readonly provider: string
  readonly description?: string | undefined
  readonly efforts: readonly PreviewEffort[]
  /** The provider default; undefined means the panel offers a Default row. */
  readonly defaultEffort?: string | undefined
  readonly metrics?: PreviewModelMetrics | undefined
  readonly contextHint?: string | undefined
  readonly costHint?: string | undefined
}

/** Flatten provider groups into preview rows; ids stay opaque, never parsed. */
export function directoryPreviewModels(
  groups: readonly ModelProviderGroup[],
): PreviewModel[] {
  return groups.flatMap(group =>
    group.models.map(model => ({
      value: `${group.id}/${model.id}`,
      label: model.name,
      provider: group.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      ...previewEfforts(model.reasoning),
    } satisfies PreviewModel)),
  )
}

function previewEfforts(
  reasoning: ModelReasoning | undefined,
): Pick<PreviewModel, 'efforts' | 'defaultEffort'> {
  if (reasoning === undefined) return { efforts: [] }
  return {
    efforts: reasoning.efforts
      .filter(effort => isOfferedEffort(effort.id))
      .sort((a, b) => compareEffortIds(a.id, b.id))
      .map(effort => ({ id: effort.id, name: effort.name })),
    ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
  }
}
