/**
 * Real-host serve smoke for installed ArtCraft applications.
 *
 * Runs only when `ARTCRAFT_SMOKE=true`. For every ready pilot app it opens the
 * manifest's real headless `serve` entry through the local provider, verifies
 * the confined-root rejection, reads the observed raw command registry, closes
 * the process, and waits for whole-tree exit. It does not fabricate artifact
 * commands whose observed shape is not recorded.
 * @module @greeneek/gnk-craft-local/scripts/check-serve
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confineArtifact, craftRoots, hashCommandRegistry, loadPilotCatalog } from '@greeneek/gnk-craft'
import { spawnSubprocess } from '@greeneek/gnk-subprocess-local/src/spawn.ts'
import { discoverApp } from '../src/discovery.ts'
import { createNodeDiscoveryIo, createNodeLocalIo } from '../src/node-io.ts'
import { CraftLocalProvider } from '../src/provider.ts'

if (process.env.ARTCRAFT_SMOKE !== 'true') {
  console.log('craft-local serve smoke skipped: set ARTCRAFT_SMOKE=true on a host with ArtCraft apps installed.')
  process.exit(0)
}

const catalog = loadPilotCatalog()
const discoveryIo = createNodeDiscoveryIo()
const workspace = mkdtempSync(join(tmpdir(), 'craft-serve-smoke-'))
const handles = []
const provider = new CraftLocalProvider(createNodeLocalIo((spec) => {
  const handle = spawnSubprocess(spec)
  handles.push(handle)
  return handle
}), { requestTimeoutMs: 30_000, graceMs: 2_000, closeGraceMs: 2_000 })
let checked = 0

try {
  for (const app of catalog.apps()) {
    const discovery = discoverApp(app, discoveryIo)
    if (discovery.state !== 'ready' || discovery.executable === undefined) {
      console.log(`${app.displayName} (${app.id}): ${discovery.state} — serve smoke not applicable`)
      continue
    }
    const roots = craftRoots(join(workspace, app.id))
    const session = await provider.open({
      app,
      workspaceRoot: roots.read,
      roots,
      controlToken: randomUUID(),
      signal: new AbortController().signal,
    })
    try {
      try {
        confineArtifact(roots, '../escape')
        throw new Error(`${app.displayName} accepted an out-of-root artifact path`)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('escapes the job output root')) throw error
      }
      const tools = await session.transport.listTools()
      if (tools.length === 0) throw new Error(`${app.displayName} advertised no tools`)
      console.log(`${app.displayName} (${app.id}): ${app.transport ?? 'serve'} transport opened; ${String(tools.length)} tools advertised`)
      if (app.headless.registryMethod !== null) {
        const registry = await session.transport.readCommandRegistry()
        console.log(`${app.displayName} (${app.id}): registry ${hashCommandRegistry(registry)}`)
      }
    } finally {
      await session.close()
      const handle = handles.at(-1)
      if (handle !== undefined && !await handle.waitForExit()) {
        throw new Error(`${app.displayName} left a live process tree after close`)
      }
    }
    checked += 1
  }
} finally {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

if (checked === 0) {
  console.error('craft-local serve smoke failed: none of the pilot apps is ready; install an ArtCraft app and its CLI, then retry.')
  process.exitCode = 1
} else {
  console.log(`craft-local serve smoke passed: ${String(checked)} installed pilot app(s) opened, measured, and terminated cleanly.`)
}
