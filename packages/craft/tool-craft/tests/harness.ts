import { Context } from '@greeneek/cordis'
import SystemPrompt from '@greeneek/gnk-system-prompt'
import ToolRuntime from '@greeneek/gnk-tools'
import SkillRegistry from '@greeneek/gnk-skill'
import { CraftCatalog, CraftRuntime, hashCommandRegistry, loadPilotCatalog } from '@greeneek/gnk-craft'
import type {
  CraftAppManifest,
  CraftCallResult,
  CraftDiscovery,
  CraftHostOpenRequest,
  CraftHostProvider,
  CraftHostSession,
  CraftToolDescriptor,
  CraftTransport,
} from '@greeneek/gnk-craft'
import { ToolCallId } from '@greeneek/gnk-llm'
import * as ToolCraft from '../src/index.ts'

/** Stable registry returned by the fake app unless a test changes it. */
export const DEFAULT_REGISTRY = { commands: [{ id: 'convert', input: { type: 'object' } }] }

/** Fake app wire that records every call. */
export class FakeTransport implements CraftTransport {
  readonly calls: Array<{ name: string; args: Readonly<Record<string, unknown>>; signal: AbortSignal }> = []
  closed = false

  constructor(
    private readonly tools: readonly CraftToolDescriptor[],
    private readonly respond: (name: string) => CraftCallResult,
    private readonly registry: unknown = DEFAULT_REGISTRY,
  ) {}

  listTools(): Promise<readonly CraftToolDescriptor[]> {
    return Promise.resolve(this.tools)
  }

  readCommandRegistry(): Promise<unknown> {
    return Promise.resolve(this.registry)
  }

  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: { readonly signal: AbortSignal },
  ): Promise<CraftCallResult> {
    this.calls.push({ name, args, signal: options.signal })
    return Promise.resolve(this.respond(name))
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

/** Default catalog advertised by the fake PhotoCraft/PdfCraft app. */
export function defaultTools(): CraftToolDescriptor[] {
  return [
    { name: 'command_list', description: 'List commands', inputSchema: { type: 'object' } },
    { name: 'command_run', description: 'Run a command', inputSchema: { type: 'object' } },
    { name: 'render_preview', description: '', inputSchema: { type: 'object' } },
    { name: 'system_shell', description: 'Never bridged', inputSchema: { type: 'object' } },
  ]
}

/** Host provider fake with mutable discovery, tool catalog, and failure modes. */
export class FakeProvider implements CraftHostProvider {
  readonly id = 'fake'
  discovery: CraftDiscovery
  tools: readonly CraftToolDescriptor[]
  respond: (name: string) => CraftCallResult
  registry: unknown
  closeError: Error | undefined
  readonly opens: CraftHostOpenRequest[] = []
  readonly transports: FakeTransport[] = []

  constructor(options: {
    readonly discovery?: CraftDiscovery
    readonly tools?: readonly CraftToolDescriptor[]
    readonly respond?: (name: string) => CraftCallResult
    readonly registry?: unknown
  } = {}) {
    this.discovery = options.discovery ?? { state: 'ready', executable: '/apps/photocraft-cli' }
    this.tools = options.tools ?? defaultTools()
    this.respond = options.respond ?? (name => ({ content: [{ type: 'text', text: `ran ${name}` }] }))
    this.registry = options.registry ?? DEFAULT_REGISTRY
  }

  discover(): Promise<CraftDiscovery> {
    return Promise.resolve(this.discovery)
  }

  open(request: CraftHostOpenRequest): Promise<CraftHostSession> {
    this.opens.push(request)
    if (this.discovery.state !== 'ready' || this.discovery.executable === undefined) {
      return Promise.reject(new Error(`${request.app.displayName} is not ready: ${this.discovery.detail ?? this.discovery.state}`))
    }
    const transport = new FakeTransport(this.tools, name => this.respond(name), this.registry)
    this.transports.push(transport)
    return Promise.resolve({
      transport,
      close: async () => {
        if (this.closeError !== undefined) throw this.closeError
        transport.closed = true
      },
    })
  }
}

/** One mounted gateway harness. */
export interface Harness {
  readonly ctx: Context
  readonly provider: FakeProvider
  readonly catalog: CraftCatalog
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
}

/** Pilot catalog with a reviewed PhotoCraft baseline for recipe-lifecycle tests. */
export function reviewedCatalog(): CraftCatalog {
  const manifests = loadPilotCatalog().apps()
  const photocraft = manifests.find(manifest => manifest.id === 'photocraft')!
  return new CraftCatalog(manifests.map(manifest => manifest.id === 'photocraft'
    ? {
      ...photocraft,
      headless: { ...photocraft.headless, trustedRegistryHash: hashCommandRegistry(DEFAULT_REGISTRY) },
    }
    : manifest))
}

/** Mount Craft, tools, skills, and the gateway against one catalog. */
export async function createHarness(options: {
  readonly provider?: FakeProvider
  readonly catalog?: CraftCatalog
} = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  const catalog = options.catalog ?? reviewedCatalog()
  new CraftRuntime(ctx, {}, catalog)
  const provider = options.provider ?? new FakeProvider()
  ctx.craft.registerProvider(provider)
  const fiber = await ctx.plugin(ToolCraft)
  return { ctx, provider, catalog, fiber }
}

/** A catalog whose recipe reads fail, for mount-cleanup coverage. */
export function failingRecipeCatalog(): CraftCatalog {
  const manifests: readonly CraftAppManifest[] = reviewedCatalog().apps()
  return new CraftCatalog(manifests, (path) => {
    if (path.startsWith('recipes/')) throw new Error('recipe read failed')
    return ''
  })
}

let nextCall = 0

/** Build the execution input for one gateway or bridge call. */
export function execution(
  name: string,
  args: unknown,
  workspace?: string,
): Parameters<Context['tools']['execute']>[0] {
  nextCall += 1
  return {
    signal: new AbortController().signal,
    callId: ToolCallId(`craft-call-${String(nextCall)}`),
    name,
    arguments: args,
    ...workspace === undefined
      ? {}
      : { agent: { session: { header: { cwd: workspace } } } },
  } as never
}

/** Extract the first text block from a tool result. */
export function textOf(result: { readonly content: readonly { type: string; text?: string }[] }): string {
  const block = result.content[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text result')
  return block.text
}
