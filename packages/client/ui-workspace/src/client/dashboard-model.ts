/**
 * Dashboard facts folded from the client's authoritative Session and
 * Workspace projections. Every figure is a whole-log projection (turns,
 * steps, recorded tokens) or a list fact (counts, last update). A session
 * whose projections have not arrived yet is reported as partial rather than
 * counted as zero, and spend is reported only through the versioned pricing
 * catalog in `dashboard-pricing.ts`.
 * @module @greeneek/gnk-client-ui-workspace/dashboard-model
 */

import {
  priceUsage,
  totalCost,
  type DashboardCost,
  type DashboardPricingCatalog,
} from './dashboard-pricing.ts'

/** One session row reduced to dashboard inputs. */
export interface DashboardSession {
  readonly id: string
  readonly title: string
  readonly running: boolean
  readonly updatedAt: number
  readonly workspace: string
  readonly provider?: string
  readonly model?: string
  /** Preset the session ran, when the host projected one. */
  readonly preset?: string
  /** True for a child session the parent delegated work to. */
  readonly subagent?: boolean
  readonly turns: number
  readonly steps: number
  /** Prompt tokens the provider billed at the full input rate. */
  readonly inputTokens: number
  /** Completion tokens, reasoning included by the provider's accounting. */
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /**
   * False when the row carries no projection values yet, so its zeroes mean
   * "not measured" and must not be summed as real work.
   */
  readonly recorded: boolean
}

/** One workspace row reduced to dashboard inputs. */
export interface DashboardWorkspace {
  readonly id: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

/** Metric a breakdown is ranked by. Only recorded facts may rank a list. */
export type DashboardMetric = 'count' | 'tokens'

/** One provider group shown in the usage breakdown. */
export interface DashboardProviderUsage {
  readonly provider: string
  readonly count: number
  readonly tokens: number
}

/** One preset group shown in the usage breakdown. */
export interface DashboardPresetUsage {
  readonly preset: string
  readonly count: number
  readonly tokens: number
}

/** One model group shown in the usage breakdown. */
export interface DashboardModelUsage {
  readonly route: string
  readonly count: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** Every recorded bucket, so a token-ranked list and the totals agree. */
  readonly tokens: number
  /** Cost of this route alone, so a single unpriced model stays visible. */
  readonly cost: DashboardCost
}

/** One session row in the detail table. */
export interface DashboardSessionRow {
  readonly id: string
  readonly title: string
  readonly workspace: string
  readonly updatedAt: number
  readonly model?: string
  readonly turns: number
  readonly steps: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly recorded: boolean
}

/** Whether the fold saw every row's projections, some of them, or no sessions. */
export type DashboardDataState = 'empty' | 'partial' | 'complete'

/** Complete dashboard view model. */
export interface DashboardFacts {
  readonly sessions: number
  readonly workspaces: number
  readonly running: number
  readonly subagents: number
  readonly turns: number
  readonly steps: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** Breakdowns ranked by {@link DashboardMetric}. */
  readonly metric: DashboardMetric
  readonly models: readonly DashboardModelUsage[]
  readonly providers: readonly DashboardProviderUsage[]
  readonly presets: readonly DashboardPresetUsage[]
  /** Whole-fleet spend; unknown unless every route is priced in one currency. */
  readonly cost: DashboardCost
  /** Catalog revision behind `cost`, or `'0'` when nothing was priced. */
  readonly catalogVersion: string
  readonly dataState: DashboardDataState
  /** Sessions whose projections had not arrived when the fold ran. */
  readonly unmeasured: number
  /** Every visible session, newest first; the page filters and paginates it. */
  readonly rows: readonly DashboardSessionRow[]
}

/** Newest first with the id as a deterministic tiebreak. */
function byRecency(a: DashboardSession, b: DashboardSession): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/** Stable route label for a provider/model pair. */
function routeOf(session: DashboardSession): string | undefined {
  if (session.provider === undefined || session.model === undefined) return undefined
  return `${session.provider} ·{session.model}`
}

/** One counted label with its recorded token total. */
interface Tally {
  readonly key: string
  readonly count: number
  readonly tokens: number
}

/** Rank by the requested metric, with the label as a deterministic tiebreak. */
function byMetric(a: Tally, b: Tally, metric: DashboardMetric): number {
  const primary = metric === 'tokens' ? b.tokens - a.tokens : b.count - a.count
  if (primary !== 0) return primary
  return a.key < b.key ? -1 : 1
}

/** Count and token totals per label, ranked by the requested metric. */
function tally(values: readonly { key: string; tokens: number }[], metric: DashboardMetric): Tally[] {
  const totals = new Map<string, { count: number; tokens: number }>()
  for (const value of values) {
    const current = totals.get(value.key) ?? { count: 0, tokens: 0 }
    current.count += 1
    current.tokens += value.tokens
    totals.set(value.key, current)
  }
  return [...totals]
    .map(([key, total]) => ({ key, count: total.count, tokens: total.tokens }))
    .sort((a, b) => byMetric(a, b, metric))
}

/**
 * Fold session and workspace projections into the dashboard view model.
 * @param input - visible sessions, workspaces, archived ids, the pricing catalog, and the ranking metric.
 * @returns every headline total, breakdown, spend, and every visible row.
 */
export function dashboardFacts(input: {
  readonly sessions: readonly DashboardSession[]
  readonly workspaces: readonly DashboardWorkspace[]
  readonly archivedSessionIds: readonly string[]
  readonly pricing?: DashboardPricingCatalog
  readonly metric?: DashboardMetric
}): DashboardFacts {
  const metric = input.metric ?? 'count'
  const archived = new Set(input.archivedSessionIds)
  const visible = input.sessions.filter(session => !archived.has(session.id))
  // An unmeasured row contributes names and recency, never a token count: its
  // zeroes are the absence of a projection, not observed work.
  const measured = visible.filter(session => session.recorded)
  const routes = new Map<string, {
    provider: string
    model: string
    count: number
    at: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>()
  for (const session of visible) {
    const route = routeOf(session)
    if (route === undefined || session.provider === undefined || session.model === undefined) continue
    const current = routes.get(route) ?? {
      provider: session.provider,
      model: session.model,
      count: 0,
      at: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    current.count += 1
    current.at = Math.max(current.at, session.updatedAt)
    if (session.recorded) {
      current.inputTokens += session.inputTokens
      current.outputTokens += session.outputTokens
      current.cacheReadTokens += session.cacheReadTokens
      current.cacheWriteTokens += session.cacheWriteTokens
    }
    routes.set(route, current)
  }
  const catalog = input.pricing
  const modelEntries = [...routes]
    .map(([route, usage]) => ({
      route,
      usage,
      tokens: usage.inputTokens + usage.outputTokens
        + usage.cacheReadTokens + usage.cacheWriteTokens,
    }))
    .sort((a, b) => byMetric(
      { key: a.route, count: a.usage.count, tokens: a.tokens },
      { key: b.route, count: b.usage.count, tokens: b.tokens },
      metric,
    ))
  const models: DashboardModelUsage[] = modelEntries.map(({ route, usage, tokens }) => ({
    route,
    count: usage.count,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    tokens,
    cost: catalog === undefined
      ? { kind: 'unknown', reason: 'no-catalog-entry' }
      : priceUsage(catalog, usage, usage, usage.at),
  }))
  const cost = totalCost(models.map(model => model.cost))
  const rows = [...visible].sort(byRecency).map((session) => {
    const model = routeOf(session)
    return {
      id: session.id,
      title: session.title,
      workspace: session.workspace,
      updatedAt: session.updatedAt,
      ...(model === undefined ? {} : { model }),
      turns: session.recorded ? session.turns : 0,
      steps: session.recorded ? session.steps : 0,
      inputTokens: session.recorded ? session.inputTokens : 0,
      outputTokens: session.recorded ? session.outputTokens : 0,
      recorded: session.recorded,
    }
  })
  const recordedTokens = (session: DashboardSession): number => session.recorded
    ? session.inputTokens + session.outputTokens + session.cacheReadTokens + session.cacheWriteTokens
    : 0
  const unmeasured = visible.length - measured.length
  return {
    sessions: visible.length,
    workspaces: input.workspaces.length,
    running: visible.filter(session => session.running).length,
    subagents: visible.filter(session => session.subagent === true).length,
    turns: measured.reduce((total, session) => total + session.turns, 0),
    steps: measured.reduce((total, session) => total + session.steps, 0),
    inputTokens: measured.reduce((total, session) => total + session.inputTokens, 0),
    outputTokens: measured.reduce((total, session) => total + session.outputTokens, 0),
    cacheReadTokens: measured.reduce((total, session) => total + session.cacheReadTokens, 0),
    cacheWriteTokens: measured.reduce((total, session) => total + session.cacheWriteTokens, 0),
    metric,
    models: models.map(({ route, count, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, tokens, cost: modelCost }) => ({
      route, count, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, tokens, cost: modelCost,
    })),
    providers: tally(
      visible.flatMap(session => session.provider === undefined
        ? []
        : [{ key: session.provider, tokens: recordedTokens(session) }]),
      metric,
    ).map(entry => ({ provider: entry.key, count: entry.count, tokens: entry.tokens })),
    presets: tally(
      visible.flatMap(session => session.preset === undefined
        ? []
        : [{ key: session.preset, tokens: recordedTokens(session) }]),
      metric,
    ).map(entry => ({ preset: entry.key, count: entry.count, tokens: entry.tokens })),
    cost,
    catalogVersion: cost.kind === 'known' ? cost.catalogVersion : catalog?.version ?? '0',
    dataState: visible.length === 0 ? 'empty' : unmeasured === 0 ? 'complete' : 'partial',
    unmeasured,
    rows,
  }
}
