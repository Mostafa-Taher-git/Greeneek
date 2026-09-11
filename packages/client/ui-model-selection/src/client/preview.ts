/**
 * Preview-model projection: the presentational shape the selector panel
 * renders, decoupled from the session directory so the panel stays a pure
 * props-driven component (like a pasted UI kit piece) while Greeneek feeds
 * it live catalog data through `directoryPreviewModels`.
 */
import type {
  ModelProviderGroup, ModelReasoning,
} from '@greeneek/gnk-api-session-controller/types'

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
    efforts: reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
    ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
  }
}
