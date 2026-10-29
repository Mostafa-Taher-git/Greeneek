/**
 * Dashboard facts folded from the client's authoritative Session and
 * Workspace projections. Every figure is a whole-log projection (turns,
 * steps, recorded output tokens) or a list fact (counts, last update); input
 * tokens and cost are not recorded locally, so they never appear here.
 * @module @greeneek/gnk-client-ui-workspace/dashboard-model
 */

/** One session row reduced to dashboard inputs. */
export interface DashboardSession {
  readonly id: string
  readonly title: string
  readonly running: boolean
  readonly updatedAt: number
  readonly workspace: string
  readonly provider?: string
  readonly model?: string
  readonly turns: number
  readonly steps: number
  readonly outputTokens: number
}

/** One workspace row reduced to dashboard inputs. */
export interface DashboardWorkspace {
  readonly id: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

/** One model group shown in the usage breakdown. */
export interface DashboardModelUsage {
  readonly route: string
  readonly count: number
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
  readonly outputTokens: number
}

/** Complete dashboard view model. */
export interface DashboardFacts {
  readonly sessions: number
  readonly workspaces: number
  readonly running: number
  readonly turns: number
  readonly steps: number
  readonly outputTokens: number
  readonly models: readonly DashboardModelUsage[]
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

/**
 * Fold session and workspace projections into the dashboard view model.
 * @param input - visible sessions, workspaces, and the archived session ids.
 * @returns every headline total, model usage, and the recent rows.
 */
export function dashboardFacts(input: {
  readonly sessions: readonly DashboardSession[]
  readonly workspaces: readonly DashboardWorkspace[]
  readonly archivedSessionIds: readonly string[]
}): DashboardFacts {
  const archived = new Set(input.archivedSessionIds)
  const visible = input.sessions.filter(session => !archived.has(session.id))
  const counts = new Map<string, number>()
  for (const session of visible) {
    const route = routeOf(session)
    if (route !== undefined) counts.set(route, (counts.get(route) ?? 0) + 1)
  }
  const models = [...counts]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count || (a.route < b.route ? -1 : 1))
  const recent = [...visible].sort(byRecency).slice(0, 8).map((session) => {
    const model = routeOf(session)
    return {
      id: session.id,
      title: session.title,
      workspace: session.workspace,
      updatedAt: session.updatedAt,
      ...(model === undefined ? {} : { model }),
      turns: session.turns,
      steps: session.steps,
      outputTokens: session.outputTokens,
    }
  })
  return {
    sessions: visible.length,
    workspaces: input.workspaces.length,
    running: visible.filter(session => session.running).length,
    turns: visible.reduce((total, session) => total + session.turns, 0),
    steps: visible.reduce((total, session) => total + session.steps, 0),
    outputTokens: visible.reduce((total, session) => total + session.outputTokens, 0),
    models,
    recent,
  }
}
