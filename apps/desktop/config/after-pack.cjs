const { cpSync, existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } = require('node:fs')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')

/**
 * Fail the pack when the copied app tree contains a link that leaves it or
 * keeps an absolute target. A link that works only on the build machine is
 * exactly the v0.3.6 failure: it resolves during staging and dangles after
 * installation.
 * @param root - packaged `resources/app` directory.
 */
function assertSelfContained(root) {
  const problems = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      let linked = entry.isSymbolicLink()
      if (!linked && entry.isDirectory()) {
        try {
          linked = lstatSync(full).isSymbolicLink()
        } catch {
          linked = false
        }
      }
      if (linked) {
        const rel = relative(root, full)
        let target
        try {
          target = readlinkSync(full)
        } catch {
          problems.push(`${rel} (unreadable link)`)
          continue
        }
        let real
        try {
          real = realpathSync(full)
        } catch {
          problems.push(`${rel} -> ${target} (dangling)`)
          continue
        }
        const back = relative(root, real)
        if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) {
          problems.push(`${rel} -> ${real} (escapes the app)`)
        } else if (isAbsolute(target)) {
          problems.push(`${rel} -> ${target} (absolute target)`)
        }
        continue
      }
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(root)
  if (problems.length > 0) {
    const shown = problems.slice(0, 20).join('\n')
    const more = problems.length > 20 ? `\n… ${problems.length - 20} more` : ''
    throw new Error(`after-pack: packaged app is not self-contained (${problems.length} links):\n${shown}${more}`)
  }
}

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
  assertSelfContained(join(context.appOutDir, 'resources', 'app'))
}
