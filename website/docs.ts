/**
 * Canonical publication manifest for the documentation website.
 *
 * Markdown stays in its owning repository tier. This manifest maps each
 * canonical English source into one route tree instead of copying Markdown.
 */

/** Sidebar collection rendered for one top-level module. */
export type DocsSidebar =
  | 'guide'
  | 'develop'
  | 'reference'

/** A page projected into the VitePress source tree. */
export interface DocsPage {
  /** Repository-relative canonical Markdown source. */
  source: string
  /** VitePress route, including the `.md` suffix. */
  route: string
  /** Navigation label shown in the sidebar. */
  label: string
  /** Sidebar collection that owns the page, or null for the home page. */
  sidebar: DocsSidebar | null
  /** Section label within the sidebar. */
  section: string
  /** Stable order within the section. */
  order: number
  /** Heading levels included in this page's VitePress outline. */
  outline?: number | readonly [number, number] | 'deep' | false
  /** Additional repository paths that resolve to this page. */
  sourceAliases?: string[]
}

interface PageEntry {
  source: string
  route: string
  label: string
  sidebar: DocsSidebar | null
  section: string
  order: number
  outline?: DocsPage['outline']
  sourceAliases?: string[]
}

const homeAndGuide: PageEntry[] = [
  {
    source: 'docs/user/index.md',
    route: 'index.md',
    label: 'Greeneek Harness',
    sidebar: null,
    section: 'Home',
    order: 0,
  },
  {
    source: 'docs/user/guide/index.md',
    route: 'guide/quickstart.md',
    label: 'Use the Web UI',
    sidebar: 'guide',
    section: 'Guide',
    order: 1,
    sourceAliases: ['docs/user/guide'],
  },
  {
    source: 'docs/user/guide/providers.md',
    route: 'guide/providers.md',
    label: 'Configure models',
    sidebar: 'guide',
    section: 'Guide',
    order: 2,
  },
  {
    source: 'docs/user/guide/desktop.md',
    route: 'guide/desktop.md',
    label: 'Install Desktop',
    sidebar: 'guide',
    section: 'Guide',
    order: 3,
  },
  {
    source: 'docs/user/guide/python-sdk.md',
    route: 'guide/python-sdk.md',
    label: 'Python',
    sidebar: 'guide',
    section: 'SDK',
    order: 1,
  },
  {
    source: 'docs/user/guide/github-review.md',
    route: 'guide/github-review.md',
    label: 'GitHub review sessions',
    sidebar: 'guide',
    section: 'Automation',
    order: 1,
  },
  {
    source: 'docs/user/guide/schedule.md',
    route: 'guide/schedule.md',
    label: 'Session reminders',
    sidebar: 'guide',
    section: 'Automation',
    order: 2,
  },
  {
    source: 'docs/user/guide/mcp-memory.md',
    route: 'guide/mcp-memory.md',
    label: 'Memory MCP',
    sidebar: 'guide',
    section: 'Integrations',
    order: 1,
  },
]

const develop: PageEntry[] = [
  {
    source: 'docs/user/develop/basic/index.md',
    route: 'develop/basic/index.md',
    label: 'Your first Harness plugin',
    sidebar: 'develop',
    section: 'Basics',
    order: 1,
    sourceAliases: ['docs/user/develop/basic'],
  },
  {
    source: 'docs/user/develop/basic/tool.md',
    route: 'develop/basic/tool.md',
    label: 'Build a tool',
    sidebar: 'develop',
    section: 'Basics',
    order: 2,
  },
  {
    source: 'docs/user/develop/basic/config.md',
    route: 'develop/basic/config.md',
    label: 'Plugin configuration',
    sidebar: 'develop',
    section: 'Basics',
    order: 3,
  },
  {
    source: 'docs/user/develop/basic/publish.md',
    route: 'develop/basic/publish.md',
    label: 'Package and install',
    sidebar: 'develop',
    section: 'Basics',
    order: 4,
  },
  {
    source: 'docs/user/develop/framework/index.md',
    route: 'develop/framework/index.md',
    label: 'Plugin lifecycle',
    sidebar: 'develop',
    section: 'Framework',
    order: 1,
    sourceAliases: ['docs/user/develop/framework'],
  },
  {
    source: 'docs/user/develop/framework/service.md',
    route: 'develop/framework/service.md',
    label: 'Services and dependencies',
    sidebar: 'develop',
    section: 'Framework',
    order: 2,
  },
  {
    source: 'docs/user/develop/framework/events.md',
    route: 'develop/framework/events.md',
    label: 'Event system',
    sidebar: 'develop',
    section: 'Framework',
    order: 3,
  },
  {
    source: 'docs/user/develop/practice/index.md',
    route: 'develop/practice/index.md',
    label: 'Capability layering',
    sidebar: 'develop',
    section: 'Practice',
    order: 1,
    sourceAliases: ['docs/user/develop/practice'],
  },
  {
    source: 'docs/user/develop/practice/llm-adapter.md',
    route: 'develop/practice/llm-adapter.md',
    label: 'LLM adapter',
    sidebar: 'develop',
    section: 'Practice',
    order: 2,
  },
  {
    source: 'docs/user/develop/practice/dynamic-cordis.md',
    route: 'develop/practice/dynamic-cordis.md',
    label: 'Runtime Cordis tools',
    sidebar: 'develop',
    section: 'Practice',
    order: 3,
  },
]

const cordisTutorial: PageEntry[] = ([
  ['index.md', 'Overview'],
  ['01-first-plugin.md', '1. Your first plugin'],
  ['02-lifecycle-and-effects.md', '2. Lifecycle and effects'],
  ['03-services.md', '3. Services'],
  ['04-events.md', '4. Events'],
  ['05-config.md', '5. Configuration'],
  ['06-composition-and-hmr.md', '6. Composition and HMR'],
  ['07-into-the-harness.md', '7. Into the harness'],
] as const).map(([file, label], order): PageEntry => ({
  source: `docs/cordis-tutorial/${file}`,
  route: `develop/cordis-tutorial/${file}`,
  label,
  sidebar: 'develop',
  section: 'Cordis framework tutorial',
  order,
  ...(file === 'index.md' ? { sourceAliases: ['docs/cordis-tutorial'] } : {}),
}))

const cordisPrimerReference: PageEntry[] = [
  {
    source: 'docs/cordis-primer.md',
    route: 'reference/cordis-primer.md',
    label: 'Cordis primer',
    sidebar: 'reference',
    section: 'Concepts',
    order: 1,
  },
]

/**
 * Subsystem pages grouped by the concern they document, as `[English
 * section, pages]`. One flat list of every subsystem pushed the rest of
 * the reference sidebar below the fold.
 */
const subsystemGroups = [
  ['Overview', [
    ['README.md', 'Subsystems'],
  ]],
  ['Core and scopes', [
    ['core.md', 'Core'],
    ['scope.md', 'Scopes'],
    ['invariants.md', 'Runtime invariants'],
  ]],
  ['Sessions and persistence', [
    ['session.md', 'Sessions'],
    ['session-query.md', 'Session query'],
    ['session-reference.md', 'Session references'],
    ['session-title.md', 'Session titles'],
    ['session-projection.md', 'Session projections'],
    ['persistence.md', 'Session persistence'],
    ['spill.md', 'Spill storage'],
    ['session-telemetry.md', 'SessionTelemetryBackend'],
  ]],
  ['Model and context', [
    ['llm-streaming.md', 'LLM streaming'],
    ['token-meter.md', 'Token metering'],
    ['system-prompt.md', 'System prompts'],
    ['compaction.md', 'Compaction'],
  ]],
  ['Execution and tools', [
    ['tools.md', 'Tools'],
    ['shell.md', 'Bash execution'],
    ['subprocess.md', 'Subprocesses'],
    ['terminal.md', 'PTY sessions'],
    ['jobs.md', 'Background jobs'],
    ['filesystem.md', 'Filesystem'],
    ['lsp.md', 'LSP navigation'],
    ['code-runtime.md', 'Code runtime'],
    ['web.md', 'Web access'],
    ['skills.md', 'Skills'],
    ['workflow.md', 'Workflows'],
    ['subagent.md', 'Subagents'],
  ]],
  ['Policy and interaction', [
    ['approval.md', 'Approvals'],
    ['permission-presets.md', 'Permission presets'],
    ['sandbox.md', 'Sandboxing'],
    ['plan.md', 'Plan mode'],
    ['user-questions.md', 'User interaction'],
    ['commands.md', 'Human commands'],
    ['goal.md', 'Goals'],
    ['schedule.md', 'Scheduled reminders'],
  ]],
  ['Platform and access', [
    ['web-server.md', 'HTTP server'],
    ['web-client.md', 'Web Client architecture'],
    ['client-modules.md', 'Client modules'],
    ['slots.md', 'Client slots'],
    ['conversation.md', 'Conversation assembly'],
    ['typert.md', 'Typert'],
    ['storage.md', 'Storage'],
    ['workspace.md', 'Workspaces'],
    ['settings.md', 'User settings'],
    ['credentials.md', 'User credentials'],
    ['desktop.md', 'Desktop shell'],
  ]],
] as const

const subsystemsReference: PageEntry[] = subsystemGroups.flatMap(([section, files]) =>
  files.map(([file, label], order): PageEntry => ({
    source: `docs/subsystems/${file}`,
    route: file === 'README.md' ? 'reference/subsystems/index.md' : `reference/subsystems/${file}`,
    label,
    sidebar: 'reference',
    section,
    order,
    // Subsystem pages carry long third-level sections a two-level outline reaches.
    outline: [2, 3],
    ...(file === 'README.md' ? { sourceAliases: ['docs/subsystems'] } : {}),
  })),
)

const reference: PageEntry[] = [
  // `docs/greeneek-llm-api-wire-extensions.md` is a repository-only provider protocol reference.
  // Projected links intentionally resolve to its GitHub source instead of a public site route.
  {
    source: 'docs/architecture.md',
    route: 'reference/index.md',
    label: 'Architecture',
    sidebar: 'reference',
    section: 'Concepts',
    order: 0,
  },
  {
    source: 'docs/capability-seams.md',
    route: 'reference/capability-seams.md',
    label: 'Capability services',
    sidebar: 'reference',
    section: 'Concepts',
    order: 2,
  },
  {
    source: 'docs/agent-lifecycle.md',
    route: 'reference/agent-lifecycle.md',
    label: 'Agent lifecycle',
    sidebar: 'reference',
    section: 'Concepts',
    order: 3,
  },
  {
    source: 'docs/tool-execution-pipeline.md',
    route: 'reference/tool-execution-pipeline.md',
    label: 'Tool execution',
    sidebar: 'reference',
    section: 'Concepts',
    order: 4,
  },
  {
    source: 'docs/api-gateway.md',
    route: 'reference/api-gateway.md',
    label: 'API Gateway',
    sidebar: 'reference',
    section: 'Concepts',
    order: 5,
  },
  {
    source: 'docs/config-catalog.md',
    route: 'reference/config-catalog.md',
    label: 'Plugin configuration',
    sidebar: 'reference',
    section: 'Generated reference',
    order: 0,
  },
  {
    source: 'docs/tool-catalog.md',
    route: 'reference/tool-catalog.md',
    label: 'Tool schemas',
    sidebar: 'reference',
    section: 'Generated reference',
    order: 1,
  },
  {
    source: 'docs/persistence-catalog.md',
    route: 'reference/persistence-catalog.md',
    label: 'Persistence events',
    sidebar: 'reference',
    section: 'Generated reference',
    order: 2,
    outline: 'deep',
  },
  {
    source: 'docs/cordis-api/context.md',
    route: 'reference/cordis-api/context.md',
    label: 'Context',
    sidebar: 'reference',
    section: 'Cordis Core API',
    order: 0,
  },
  {
    source: 'docs/cordis-api/events.md',
    route: 'reference/cordis-api/events.md',
    label: 'Events',
    sidebar: 'reference',
    section: 'Cordis Core API',
    order: 1,
  },
  {
    source: 'docs/cordis-api/fiber.md',
    route: 'reference/cordis-api/fiber.md',
    label: 'Fiber',
    sidebar: 'reference',
    section: 'Cordis Core API',
    order: 2,
  },
  {
    source: 'docs/cordis-api/registry.md',
    route: 'reference/cordis-api/registry.md',
    label: 'Plugin Registry',
    sidebar: 'reference',
    section: 'Cordis Core API',
    order: 3,
  },
  {
    source: 'docs/cordis-api/service.md',
    route: 'reference/cordis-api/service.md',
    label: 'Service',
    sidebar: 'reference',
    section: 'Cordis Core API',
    order: 4,
  },
  {
    source: 'docs/cordis-api/inherited.md',
    route: 'reference/cordis-api/inherited.md',
    label: 'Inherited surface',
    sidebar: 'reference',
    section: 'Cordis Core API',
    order: 5,
  },
  {
    source: 'docs/cookbook/adding-a-package.md',
    route: 'reference/cookbook/adding-a-package.md',
    label: 'Adding a package',
    sidebar: 'reference',
    section: 'Cookbook',
    order: 0,
  },
  {
    source: 'docs/cookbook/adding-a-tool.md',
    route: 'reference/cookbook/adding-a-tool.md',
    label: 'Adding a tool',
    sidebar: 'reference',
    section: 'Cookbook',
    order: 1,
  },
  {
    source: 'docs/cookbook/adding-an-llm-adapter.md',
    route: 'reference/cookbook/adding-an-llm-adapter.md',
    label: 'Adding an LLM adapter',
    sidebar: 'reference',
    section: 'Cookbook',
    order: 2,
  },
  {
    source: 'docs/cookbook/adding-a-settings-card.md',
    route: 'reference/cookbook/adding-a-settings-card.md',
    label: 'Adding a settings card',
    sidebar: 'reference',
    section: 'Cookbook',
    order: 3,
  },
  {
    source: 'docs/cookbook/extension-cookbook.md',
    route: 'reference/cookbook/extension-cookbook.md',
    label: 'Extension patterns',
    sidebar: 'reference',
    section: 'Cookbook',
    order: 4,
  },
]

/**
 * Sidebar collections, in the order the site's navigation presents them.
 * The navigation bar and the llms.txt index both read this sequence, so a
 * new collection lands in both surfaces together.
 */
export const collections: readonly DocsSidebar[] = ['guide', 'develop', 'reference']

/** A sidebar group, matched to pages by `label`. */
export interface DocsSection {
  /** Group heading, equal to the `section` field of every page it holds. */
  label: string
  /** Render the group collapsed until it holds the page being read. */
  collapsed?: boolean
}

/**
 * Every sidebar group, in the order the sidebar renders it.
 *
 * The subsystem groups collapse because together they outnumber the rest of the
 * reference sidebar; expanded, they push every other group below the fold.
 */
const sections: readonly DocsSection[] = [
  { label: 'Guide' }, { label: 'SDK' }, { label: 'Automation' }, { label: 'Integrations' },
  { label: 'Basics' }, { label: 'Framework' }, { label: 'Practice' }, { label: 'Cordis framework tutorial' },
  { label: 'Concepts' }, { label: 'Generated reference' }, { label: 'Cordis Core API' }, { label: 'Cookbook' },
  { label: 'Overview' },
  { label: 'Core and scopes', collapsed: true },
  { label: 'Sessions and persistence', collapsed: true },
  { label: 'Model and context', collapsed: true },
  { label: 'Execution and tools', collapsed: true },
  { label: 'Policy and interaction', collapsed: true },
  { label: 'Platform and access', collapsed: true },
]

/**
 * Placement and collapse behavior of one sidebar group.
 *
 * @param label - Section label carried by the pages in the group.
 * @returns The declared group, plus its zero-based position.
 * @throws When no placement is declared for the label. Ranking by list
 *   membership alone would sort an undeclared group silently ahead of every
 *   declared one.
 */
export function sectionSpec(label: string): DocsSection & { index: number } {
  const section = sections.find(candidate => candidate.label === label)
  if (section === undefined) throw new Error(`Sidebar section "${label}" has no placement.`)
  return { ...section, index: sections.indexOf(section) }
}

/** Every canonical page published by the documentation website. */
export const docsPages: DocsPage[] = [
  ...homeAndGuide,
  ...develop,
  ...cordisTutorial,
  ...cordisPrimerReference,
  ...subsystemsReference,
  ...reference,
]

/**
 * Pages of one sidebar collection, in the order the sidebar lists them.
 *
 * @param collection - Sidebar collection to read.
 * @returns The collection's pages, ordered by section placement then by `order`.
 */
export function orderedPages(collection: DocsSidebar): DocsPage[] {
  return docsPages
    .filter(page => page.sidebar === collection)
    .sort((left, right) => (
      sectionSpec(left.section).index - sectionSpec(right.section).index
      || left.order - right.order
    ))
}

/**
 * Site-relative link for a published route.
 *
 * @param route - Manifest route, including its `.md` suffix.
 * @returns The link VitePress serves the route at.
 */
export function routeLink(route: string): string {
  return `/${route.replace(/(?:index)?\.md$/, '')}`
}

/**
 * Where a top-level navigation item lands.
 *
 * The target is derived rather than written down: a collection whose first page
 * is renamed or reordered would otherwise leave the navigation bar pointing at
 * a route the manifest no longer publishes.
 *
 * @param collection - Sidebar collection the item opens.
 * @returns Site-relative link of the collection's first page.
 * @throws When the collection publishes no page.
 */
export function landingLink(collection: DocsSidebar): string {
  const first = orderedPages(collection)[0]
  if (first === undefined) throw new Error(`Sidebar collection "${collection}" publishes no page.`)
  return routeLink(first.route)
}
