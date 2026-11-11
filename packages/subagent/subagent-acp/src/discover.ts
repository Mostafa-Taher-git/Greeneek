/**
 * Live capability discovery for one ACP Harness. The probe speaks only the ACP
 * initialization and session handshake: it never sends a prompt, so it costs no
 * inference tokens. Everything it reports is read from the child's own
 * `initialize` and `session/new` responses; a Harness that advertises nothing
 * yields `unknown` catalogs instead of a fabricated list.
 *
 * @module @greeneek/gnk-subagent-acp/discover
 */

import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type { HarnessCapabilities } from '@greeneek/gnk-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@greeneek/gnk-subprocess'
import { harnessCapabilitiesFromAcp } from './acp-config.ts'
import { disposeAcpChild } from './run.ts'

/** Inputs for one ACP capability probe. */
export interface AcpDiscoverySpec {
  /** Harness implementation identity, shared by every connection of the product. */
  readonly harnessId: string
  /** Product display name. */
  readonly displayName?: string
  /** The executable to spawn. */
  readonly command: string
  /** Arguments passed to the executable. */
  readonly args: readonly string[]
  /** Absolute workspace announced to `session/new`. */
  readonly cwd: string
  /** Explicit child environment layered over the credential-scrubbed parent. */
  readonly env: Record<string, string>
  /** Grace window for the child's EOF-driven flush. */
  readonly disposeEofGraceMs: number
  /** Termination-escalation grace. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Cancellation for the probe and its child process. */
  readonly signal: AbortSignal
}

/** Reject a probe as soon as its caller cancels. */
function abortRace(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('ACP capability probe cancelled before the child answered'))
      return
    }
    signal.addEventListener('abort', () => {
      reject(new Error('ACP capability probe cancelled before the child answered'))
    }, { once: true })
  })
}

/**
 * Probe one ACP Harness without prompting it.
 * @param spec - executable, workspace, environment, process service, and cancellation.
 * @returns the capabilities the child advertised.
 * @throws When the child cannot start, rejects the handshake, or the probe is cancelled.
 */
export async function discoverAcpHarness(spec: AcpDiscoverySpec): Promise<HarnessCapabilities> {
  if (spec.signal.aborted) throw new Error('ACP capability probe cancelled before the child started')
  const child = spec.spawn({
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  /* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
  if (child.stdin === undefined || child.stdout === undefined) {
    await disposeAcpChild(child, spec.disposeEofGraceMs)
    throw new Error('subagent-acp: subprocess implementation dropped a piped protocol stream')
  }
  /* v8 ignore stop */

  const clientApp = createAcpClientApp({ name: 'greeneek-harness-discovery' })
  const connection = clientApp.connect(ndJsonStream(
    NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  ))

  try {
    const initialize = await Promise.race([
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      }),
      abortRace(spec.signal),
    ])
    const session = await Promise.race([
      connection.agent.request(methods.agent.session.new, { cwd: spec.cwd, mcpServers: [] }),
      abortRace(spec.signal),
    ])
    return harnessCapabilitiesFromAcp(initialize, session, {
      harnessId: spec.harnessId,
      ...spec.displayName === undefined ? {} : { displayName: spec.displayName },
    })
  } finally {
    await disposeAcpChild(child, spec.disposeEofGraceMs)
  }
}
