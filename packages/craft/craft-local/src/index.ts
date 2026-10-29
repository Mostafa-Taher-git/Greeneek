/**
 * Plugin entry for the local Craft host provider. Load after `ctx.craft` and
 * `ctx.subprocess`; it registers one `craft-local` provider so the service can
 * discover and spawn PhotoCraft/PdfCraft headless sessions.
 * @module @greeneek/gnk-craft-local
 */

import { Context } from '@greeneek/cordis'
import z from '@greeneek/schemastery'
import type {} from '@greeneek/gnk-craft'
import { createNodeLocalIo } from './node-io.ts'
import { CraftLocalProvider } from './provider.ts'
import type { CraftLocalConfig, CraftLocalIo } from './types.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'craft-local'

/** Services the provider registers against: the Craft seam and its process boundary. */
export const inject = ['craft', 'subprocess']

/** Default per-request JSON-RPC deadline. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** Default terminate-escalation grace for one app process tree. */
export const DEFAULT_GRACE_MS = 2_000
/** Default bound on waiting for a terminated process to settle. */
export const DEFAULT_CLOSE_GRACE_MS = 2_000

/** Plugin configuration schema. */
export const Config: z<CraftLocalConfig> = z.object({
  requestTimeoutMs: z.number().default(DEFAULT_REQUEST_TIMEOUT_MS),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
  closeGraceMs: z.number().default(DEFAULT_CLOSE_GRACE_MS),
})

/**
 * Configuration a composition may hand {@link apply}: every field optional,
 * resolved against the documented defaults. Distinct from the resolved
 * {@link CraftLocalConfig} the schema materializes and the provider carries.
 */
export interface Config {
  /** Per JSON-RPC request deadline in milliseconds. @default 30000 */
  readonly requestTimeoutMs?: number
  /** Terminate escalation grace for a spawned app process tree. @default 2000 */
  readonly graceMs?: number
  /** Bound on waiting for a terminated process to settle during close. @default 2000 */
  readonly closeGraceMs?: number
}

/**
 * Build the provider's Node boundary from the owning context.
 * @param ctx - context carrying `subprocess` and `logger`.
 * @returns the local provider boundary.
 */
export function createLocalIo(ctx: Context): CraftLocalIo {
  return createNodeLocalIo(
    spec => ctx.subprocess.spawn(spec),
    { warn: ctx.logger.warn.bind(ctx.logger) },
  )
}

/**
 * Register the local host provider.
 * @param ctx - context carrying `craft` and `subprocess`.
 * @param config - optional deadlines and termination grace; omitted fields use the documented defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: CraftLocalConfig = {
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    graceMs: config.graceMs ?? DEFAULT_GRACE_MS,
    closeGraceMs: config.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
  }
  assertTimer('requestTimeoutMs', resolved.requestTimeoutMs)
  assertTimer('graceMs', resolved.graceMs)
  assertTimer('closeGraceMs', resolved.closeGraceMs)
  const provider = new CraftLocalProvider(createLocalIo(ctx), resolved)
  ctx.effect(() => ctx.craft.registerProvider(provider), 'craft-local.registerProvider')
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`craft-local: ${name} must be a positive integer no greater than 2147483647`)
  }
}

export type { CraftLocalConfig } from './types.ts'
