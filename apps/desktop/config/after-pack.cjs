const { cpSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

/**
 * Graft the pre-pruned staging closure into the packaged app. The builder's
 * own node-module scan shells out to a package manager that cannot read this
 * hand-built tree, so it ships zero node_modules; staging already boots
 * green under smoke, so copy it verbatim. Fails loud if the builder ever
 * ships node_modules itself (assumption change, not silent duplication).
 */
exports.default = async function afterPack(context) {
  const staging = resolve(context.appOutDir, '..', '..')
  const source = join(staging, 'node_modules')
  const dest = join(context.appOutDir, 'resources', 'app', 'node_modules')
  if (!existsSync(source)) throw new Error(`after-pack: staging closure missing: ${source}`)
  if (existsSync(dest)) {
    throw new Error(`after-pack: ${dest} already exists; the builder shipped node_modules after all`)
  }
  cpSync(source, dest, { recursive: true })
}
