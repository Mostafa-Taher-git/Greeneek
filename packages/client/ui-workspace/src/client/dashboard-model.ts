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

/** One provider group shown in the usage breakdown. */
export interface DashboardProviderUsage {
  readonly provider: string
  readonly count: number
}

/** One preset group shown in the usage breakdown. */
export interface DashboardPresetUsage {
  readonly preset: string
  readonly count: number
}

/** One model group shown in the usage breakdown. */
export interface DashboardModelUsage {
  readonly route: string
  readonly count: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** Cost of this route alone, so a single unpriced model stays visible. */
  readonly cost: DashboardCost
}

/** One recent session row. */
export interface DashboardRecentSession {
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
  readonly recent: readonly DashboardRecentSession[]
}

/** Newest first with the id as a deterministic tiebreak. */
function byRecency(a: DashboardSession, b: DashboardSession): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/** Stable route label for a provider/model pair. */
function routeOf(session: DashboardSession): string | undefined {
  if (session.provider === undefined || session.model === undefined) return undefined
  return `${session.provider} · ${session.model}`
}

/** Count occurrences, sorted by descending count then label. */
function tally(values: readonly string[]): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
}

/**
 * Fold session and workspace projections into the dashboard view model.
 * @param input - visible sessions, workspaces, archived ids, and the pricing catalog.
 * @returns every headline total, breakdown, spend, and the recent rows.
 */
export function dashboardFacts(input: {
  readonly sessions: readonly DashboardSession[]
  readonly workspaces: readonly DashboardWorkspace[]
  readonly archivedSessionIds: readonly string[]
  readonly pricing?: DashboardPricingCatalog
}): DashboardFacts {
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
  const models = [...routes]
    .sort(([routeA, a], [routeB, b]) => b.count - a.count || (routeA < routeB ? -1 : 1))
    .map(([route, usage]) => ({
      route,
      count: usage.count,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cost: catalog === undefined
        ? { kind: 'unknown' as const, reason: 'no-catalog-entry' as const }
        : priceUsage(catalog, usage, usage, usage.at),
    }))
  const cost = totalCost(models.map(model => model.cost))
  const recent = [...visible].sort(byRecency).slice(0, 8).map((session) => {
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
    models,
    providers: tally(visible.flatMap(session => session.provider === undefined ? [] : [session.provider]))
      .map(entry => ({ provider: entry.key, count: entry.count })),
    presets: tally(visible.flatMap(session => session.preset === undefined ? [] : [session.preset]))
      .map(entry => ({ preset: entry.key, count: entry.count })),
    cost,
    catalogVersion: cost.kind === 'known' ? cost.catalogVersion : catalog?.version ?? '0',
    dataState: visible.length === 0 ? 'empty' : unmeasured === 0 ? 'complete' : 'partial',
    unmeasured,
    recent,
  }
}
