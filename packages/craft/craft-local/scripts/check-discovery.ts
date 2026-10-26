/**
 * Discovery smoke for a host that has an ArtCraft application installed.
 *
 * It loads the shipped pilot manifests and runs the same installation
 * measurement the local provider serves to `ctx.craft`, printing every pilot
 * app's state and absolute CLI path. It exits non-zero unless at least one app
 * reports `ready`, and it never installs or launches an ArtCraft application.
 * @module @greeneek/gnk-craft-local/scripts/check-discovery
 */

import { loadPilotCatalog } from '@greeneek/gnk-craft'
import { discoverApp } from '../src/discovery.ts'
import { createNodeDiscoveryIo } from '../src/node-io.ts'

const catalog = loadPilotCatalog()
const io = createNodeDiscoveryIo()
let ready = 0

for (const app of catalog.apps()) {
  const discovery = discoverApp(app, io)
  const facts = [
    discovery.executable === undefined ? undefined : discovery.executable,
    discovery.version === undefined ? undefined : `version ${discovery.version}`,
    discovery.detail,
  ].filter(fact => fact !== undefined)
  if (discovery.state === 'ready') ready += 1
  console.log(`${app.displayName} (${app.id}): ${discovery.state}${facts.length === 0 ? '' : ` — ${facts.join('; ')}`}`)
}

if (ready === 0) {
  console.error(
    'craft-local discovery smoke failed: none of the pilot apps is ready '
    + `(checked ${catalog.apps().map(app => app.id).join(', ')}); install an ArtCraft app and its CLI, then retry.`,
  )
  process.exitCode = 1
} else {
  console.log(`craft-local discovery smoke passed: ${String(ready)} of ${String(catalog.apps().length)} pilot apps ready.`)
}
