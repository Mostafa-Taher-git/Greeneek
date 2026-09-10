import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { builtinModules, createRequire } from 'node:module'

/**
 * Stage a self-contained app dir for electron-builder from the already-
 * installed workspace `node_modules`, avoiding `pnpm deploy`/`pnpm install`
 * TTY/interactive blockers. Asserts runtime closure, applies platform
 * fixups, and renders the builder config.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageDir, '..', '..')
const staging = join(packageDir, '.staging', 'app')

function fail(message) {
  console.error(`stage: ${message}`)
  process.exit(1)
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function assertPresent(path, why) {
  if (!existsSync(path)) fail(`missing ${path} (${why})`)
  return path
}

/**
 * Separator-agnostic path segment check. `realpathSync` returns backslashes
 * on Windows, so a raw `.includes('/packages/')` never matches there: every
 * workspace package is then fully duplicated with its nested `node_modules`
 * until staging exhausts the disk (ENOSPC after hours of copying).
 */
function pathContainsSegment(candidate, segment) {
  return candidate.replace(/\\/g, '/').includes(`/${segment}/`)
}

function main() {
  const platform = process.platform
  console.log(`stage: platform=${platform} arch=${process.arch}`)

  // 1. Preconditions: the harness must be built before it can be staged.
  assertPresent(
    join(repoRoot, 'apps', 'cli', 'lib', 'bin.js'),
    'run `pnpm run build` first',
  )
  assertPresent(
    join(repoRoot, 'apps', 'web', 'dist', 'index.html'),
    'run `pnpm run build` first',
  )
  for (const tool of ['electron', 'node', 'pnpm']) {
    try {
      const toolManifest = JSON.parse(readFileSync(join(packageDir, 'node_modules', tool, 'package.json'), 'utf8'))
      console.log(`stage: ${tool} ${toolManifest.version}`)
    } catch {
      console.log(`stage: ${tool} version unreadable`)
    }
  }

  // 2. Stage a production closure by copying the already-installed
  // workspace `node_modules` and pruning devDependency leaves. This
  // avoids `pnpm deploy`/`pnpm install` TTY prompts entirely.
  console.log(`stage: copy node_modules → ${staging}`)
  mkdirSync(staging, { recursive: true })
  copyFileSync(join(packageDir, 'package.json'), join(staging, 'package.json'))
  copyFileSync(join(repoRoot, 'pnpm-lock.yaml'), join(staging, 'pnpm-lock.yaml'))
  writeFileSync(join(staging, 'pnpm-workspace.yaml'), 'packages:\n', 'utf8')

  const desktopPackage = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const rootDev = new Set([
    ...Object.keys(rootPackage.devDependencies || {}),
    'electron',
    'electron-builder',
  ])
  for (const pkg of ['koffi', 'node', 'node-pty']) rootDev.delete(pkg)

  copyPrunedModules(join(packageDir, 'node_modules'), join(staging, 'node_modules'), rootDev, new Set(), false, staging)

  console.log(`stage: copy desktop runtime files`)
  // Whole directories, never a file list: a cherry-picked list silently
  // drops new modules (main.js imports eight files the old list missed,
  // which crashed the packaged app on launch).
  copyDirRecursive(join(packageDir, 'src'), join(staging, 'src'))
  copyDirRecursive(join(packageDir, 'config'), join(staging, 'config'))
  for (const asset of [
    'assets/tray.png',
    'assets/logo-splash.png',
    'assets/bin/pnpm',
    'assets/bin/pnpm.cmd',
    'LICENSE',
  ]) {
    copyFileEnsureDir(join(packageDir, asset), join(staging, asset))
  }
  assertStagedDirMatches(join(packageDir, 'src'), join(staging, 'src'))
  assertStagedShellImports(join(staging, 'src'))
  mkdirSync(join(staging, 'third-party-licenses'), { recursive: true })

  // 2b. Workspace closure: the pruned copy skips nested `@greeneek`
  // scopes, so transitive workspace deps resolved in-source through a
  // package's own directory would be missing at runtime (smoke caught
  // `@greeneek/gnk-atomic-write` this way). Walk staged manifests to a
  // fixpoint, materializing every missing `@greeneek` dependency from
  // the workspace source.
  const workspaceIndex = workspaceSourceIndex(repoRoot)
  materializeWorkspaceClosure(staging, workspaceIndex, rootDev)

  // 2c. External closure: nested external copies may miss their own
  // transitive deps (smoke caught `safe-buffer` under `compression`),
  // which pnpm resolves through the store layout. Walk every staged
  // manifest to a fixpoint, materializing missing externals from the
  // workspace source; version conflicts nest under the importer.
  materializeExternalClosure(staging, repoRoot, workspaceIndex)

  const gnkEntry = assertPresent(
    join(staging, 'node_modules', '@greeneek', 'gnk', 'lib', 'bin.js'),
    'staging dropped the CLI entry; check @greeneek/gnk `files`',
  )
  assertPresent(
    join(staging, 'node_modules', '@greeneek', 'gnk-web-frontend', 'dist', 'index.html'),
    'staging dropped the frontend; check @greeneek/gnk-web-frontend `files`',
  )
  const pnpmCandidates = ['pnpm.cjs', 'pnpm.mjs']
    .map((file) => join(staging, 'node_modules', 'pnpm', 'bin', file))
    .filter((file) => existsSync(file))
  if (pnpmCandidates.length === 0) fail('staging dropped the pnpm CLI')
  console.log(`stage: gnk entry ${gnkEntry}`)
  console.log(`stage: pnpm entry ${pnpmCandidates[0]}`)
  assertPresent(join(staging, 'node_modules', 'electron-updater', 'out', 'AppUpdater.js'), 'staging dropped electron-updater')
  assertPresent(join(staging, 'node_modules', 'koffi'), 'staging dropped koffi (it must be a direct dependency)')
  stageKoffiBinary(staging, repoRoot, platform, process.arch)
  try {
    run(process.execPath, ['-e', `import('koffi').then(() => console.log('stage: koffi loads'))`], staging)
  } catch {
    fail('koffi does not load from staging')
  }

  // 3. Bundled-node probe: executable, matching platform/arch.
  const nodeBinary = join(staging, 'node_modules', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
  assertPresent(nodeBinary, 'the `node` package did not stage its binary')
  try {
    accessCheck(nodeBinary)
  } catch {
    fail(`staged node is not executable: ${nodeBinary}`)
  }
  const probe = spawnSync(nodeBinary, ['-p', 'JSON.stringify({ platform: process.platform, arch: process.arch })'], { encoding: 'utf8' })
  if (probe.status !== 0) fail(`staged node does not start: ${probe.stderr}`)
  const runtime = JSON.parse(probe.stdout.trim())
  if (runtime.platform !== platform || runtime.arch !== process.arch) {
    fail(`staged node targets ${runtime.platform}/${runtime.arch}, expected ${platform}/${process.arch}`)
  }
  console.log(`stage: staged node ${runtime.platform}/${runtime.arch} probes clean`)

  // 4. The entry wrapper loads under the staged node (no-arg run must exit
  // with the usage error, proving the wrapper plus its koffi chain resolve).
  const wrapper = spawnSync(nodeBinary, [join(staging, 'src', 'gnk-node-entry.mjs')], { encoding: 'utf8' })
  const wrapperOut = `${wrapper.stdout || ''}${wrapper.stderr || ''}`
  if (wrapper.status === 0 || !wrapperOut.includes('missing gnk entry path')) {
    fail(`entry wrapper misbehaves under staged node (status ${wrapper.status}):\n${wrapperOut}`)
  }
  console.log('stage: entry wrapper loads under staged node')

  // 5. Linux fixups: packaged pty works without rebuild; landlock keeps +x.
  if (platform === 'linux') {
    const pty = spawnSync(nodeBinary, ['-e', `import('node-pty').then((pty) => { const p = pty.spawn('echo', ['OK'], {}); p.onData((d) => { process.stdout.write(d); p.kill() }) })`], {
      cwd: join(staging, 'node_modules', '@greeneek', 'gnk'),
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (pty.status !== 0 || !`${pty.stdout || ''}`.includes('OK')) {
      fail(`node-pty does not spawn under staged node:\n${pty.stderr || pty.stdout}`)
    }
    console.log('stage: node-pty spawns under staged node')
    const landlock = join(staging, 'node_modules', '@greeneek', 'node-addon-landlock-run-linux-x64')
    if (existsSync(landlock)) {
      for (const file of landlockBinaries(landlock)) {
        try {
          accessCheck(file)
        } catch {
          chmodSync(file, 0o755)
          accessCheck(file)
        }
      }
      console.log('stage: landlock binaries executable')
    }
  }

  // 6. Third-party licenses for the bundled runtimes.
  copyLicense(join(staging, 'node_modules', 'node'), staging)
  copyLicense(join(staging, 'node_modules', 'koffi'), staging)
  copyLicense(join(staging, 'node_modules', 'pnpm'), staging)

  // 7. Build icons into staging buildResources.
  mkdirSync(join(staging, 'assets'), { recursive: true })
  copyFileEnsureDir(join(packageDir, 'assets', 'icon.png'), join(staging, 'assets', 'icon.png'))
  copyFileEnsureDir(join(packageDir, 'assets', 'icon.ico'), join(staging, 'assets', 'icon.ico'))

  // 8. Shim line-endings and exec bit.
  const shim = join(staging, 'assets', 'bin', 'pnpm')
  try {
    chmodSync(shim, 0o755)
  } catch {
    fail(`cannot chmod the pnpm shim: ${shim}`)
  }

  // 9. Render the builder config.
  renderBuilderConfig(staging)
  console.log(`stage: complete → ${staging}`)
}

function accessCheck(path) {
  accessSync(path, constants.X_OK)
}

function copyFileEnsureDir(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

/** Every relative import inside the staged shell must resolve: main.js loads under Electron with no unit coverage, so a typo'd path crashes the packaged app on launch. */
function assertStagedShellImports(shellDir) {
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full)
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) sources.push(full)
    }
  }
  walk(shellDir)
  for (const file of sources) {
    const content = readFileSync(file, 'utf8')
    const specifiers = [
      ...content.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...content.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]/g),
    ].map((match) => match[1])
    for (const spec of new Set(specifiers)) {
      const base = resolve(dirname(file), spec)
      const target = existsSync(base) ? base
        : existsSync(`${base}.js`) ? `${base}.js`
        : existsSync(`${base}.mjs`) ? `${base}.mjs`
        : undefined
      if (target === undefined) fail(`staged shell import does not resolve: ${spec} (imported from ${file})`)
    }
  }
}

/** Every file under the source dir must exist in staging: fails the build if runtime files ever regress to a cherry-picked list. */
function assertStagedDirMatches(fromDir, toDir) {
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    const to = join(toDir, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) assertStagedDirMatches(join(fromDir, entry.name), to)
    else if (!existsSync(to)) fail(`staging dropped desktop runtime file: ${to}`)
  }
}

function landlockBinaries(dir) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (!entry.name.endsWith('.md') && !entry.name.endsWith('.json')) found.push(full)
    }
  }
  walk(dir)
  return found
}
const srcToDest = new Map()

function copyPrunedModules(src, dest, rootDev, visited, isWorkspacePkg, hoistDest) {
  let srcReal
  try {
    srcReal = realpathSync(src)
  } catch {
    return
  }
  const srcIsStagingSymlink = lstatSync(src).isSymbolicLink()
  const alreadyVisited = visited.has(srcReal)
  if (alreadyVisited && !srcIsStagingSymlink) return
  visited.add(srcReal)
  mkdirSync(dest, { recursive: true })
  try {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = join(src, entry.name)
      const to = join(dest, entry.name)
      try {
        if (!shouldCopyModule(entry, rootDev)) continue
        if (entry.isSymbolicLink()) {
          let targetIsDir = false
          try {
            targetIsDir = statSync(from).isDirectory()
          } catch {
            continue
          }
          if (!targetIsDir) {
            copySymlink(from, to)
            continue
          }
          const targetReal = realpathSync(from)
          srcToDest.set(srcReal, to)
          if (alreadyVisited) {
            const stagingTarget = srcToDest.get(targetReal)
            if (stagingTarget) {
              const rel = relative(dirname(to), stagingTarget)
              try { symlinkSync(rel, to) } catch {}
            }
            continue
          }
          mkdirSync(to, { recursive: true })
          const nestedIsWorkspace = pathContainsSegment(targetReal, 'packages') || pathContainsSegment(targetReal, 'vendor') || pathContainsSegment(targetReal, 'node_modules/.pnpm')
          copyPrunedModules(from, to, rootDev, visited, nestedIsWorkspace, hoistDest)
          if (nestedIsWorkspace && entry.name.startsWith('@') === false) {
            const wsPkgTarget = join(hoistDest, 'node_modules', '@greeneek', entry.name)
            mkdirSync(wsPkgTarget, { recursive: true })
            copyDirRecursive(from, wsPkgTarget)
          }
          const rel = readlinkSync(from)
          const norm = rel.startsWith('/') ? rel : join(dirname(to), rel)
          try { symlinkSync(norm, to) } catch {}
          continue
        }
        if (entry.isDirectory()) {
          if (isWorkspacePkg && entry.name === 'node_modules') {
            for (const inner of readdirSync(from, { withFileTypes: true })) {
              const innerFrom = join(from, inner.name)
              const innerTo = join(to, inner.name)
              try {
                // Nested `@greeneek` scopes stay empty by design: every
                // workspace dependency is hoisted to the staging top level
                // (plus the closure pass below), so nested copies would only
                // duplicate bytes and stall NTFS checkouts. Resolution walks
                // up to the top level; the single lockstep version makes
                // flat hoisting sound.
                if (inner.name === '@greeneek') continue
                if (!shouldCopyModule(inner, rootDev)) continue
                if (inner.isSymbolicLink()) {
                  let targetIsDir = false
                  try {
                    targetIsDir = statSync(innerFrom).isDirectory()
                  } catch {
                    continue
                  }
                  if (!targetIsDir) {
                    copySymlink(innerFrom, innerTo)
                    continue
                  }
                  const innerTargetReal = realpathSync(innerFrom)
                  srcToDest.set(innerTargetReal, innerTo)
                  if (alreadyVisited) {
                    const stagingTarget = srcToDest.get(innerTargetReal)
                    if (stagingTarget) {
                      const rel = relative(dirname(innerTo), stagingTarget)
                      try { symlinkSync(rel, innerTo) } catch {}
                    }
                    continue
                  }
                  const isExternalPkg = pathContainsSegment(innerTargetReal, 'node_modules/.pnpm')
                  if (isExternalPkg) {
                    const hoistedTo = join(hoistDest, inner.name)
                    mkdirSync(hoistedTo, { recursive: true })
                    srcToDest.set(innerTargetReal, hoistedTo)
                    copyPrunedModules(innerFrom, hoistedTo, rootDev, visited, true, hoistDest)
                    const wsRoot = resolve(innerTo, '..', '..', '..', '..')
                    const wsTarget = join(wsRoot, inner.name)
                    mkdirSync(wsTarget, { recursive: true })
                    copyDirRecursive(innerFrom, wsTarget)
                  } else {
                    mkdirSync(innerTo, { recursive: true })
                    const nestedIsWorkspace = pathContainsSegment(innerTargetReal, 'packages') || pathContainsSegment(innerTargetReal, 'vendor')
                    copyPrunedModules(innerFrom, innerTo, rootDev, visited, nestedIsWorkspace, hoistDest)
                    const rel = readlinkSync(innerFrom)
                    const norm = rel.startsWith('/') ? rel : join(dirname(innerTo), rel)
                    try { symlinkSync(norm, innerTo) } catch {}
                    const wsPkgTarget = join(hoistDest, 'node_modules', '@greeneek', inner.name)
                    mkdirSync(wsPkgTarget, { recursive: true })
                    copyDirRecursive(innerFrom, wsPkgTarget)
                  }
                  continue
                }
                if (inner.isDirectory()) {
                  mkdirSync(innerTo, { recursive: true })
                  copyPrunedModules(innerFrom, innerTo, rootDev, visited, true, hoistDest)
                } else {
                  copyFileSync(innerFrom, innerTo)
                }
              } catch (e) {
                if (e.code !== 'ENOENT') throw e
              }
            }
            continue
          }
          copyPrunedModules(from, to, rootDev, visited, isWorkspacePkg, hoistDest)
        } else {
          copyFileSync(from, to)
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
    }
  } finally {
    visited.delete(srcReal)
  }
}

function shouldCopyModule(entry, rootDev) {
  if (rootDev.has(entry.name)) return false
  if (entry.name === '.bin' || entry.name === '.pnpm') return false
  if (entry.name.startsWith('@')) return true
  if (entry.name === 'node_modules') return true
  if (entry.isDirectory()) return true
  return true
}

function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(from)
      const absTarget = join(dirname(from), target)
      try {
        const isDir = statSync(absTarget).isDirectory()
        if (isDir) {
          copyDirRecursive(absTarget, to)
        } else {
          copyFileSync(absTarget, to)
        }
      } catch {
        // broken symlink, skip
      }
    } else if (entry.isDirectory()) {
      copyDirRecursive(from, to)
    } else {
      copyFileSync(from, to)
    }
  }
}

function workspaceSourceIndex(repoRoot) {
  const index = new Map()
  const candidateDirs = []
  for (const group of ['packages', 'apps', 'vendor', 'native']) {
    let entries
    try {
      entries = readdirSync(join(repoRoot, group), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      candidateDirs.push(join(repoRoot, group, entry.name))
    }
  }
  const packageDirs = []
  for (const dir of candidateDirs) {
    if (pathContainsSegment(dir, 'packages')) {
      let pkgs
      try {
        pkgs = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const pkg of pkgs) {
        if (pkg.isDirectory() && !pkg.name.startsWith('.') && pkg.name !== 'node_modules') {
          packageDirs.push(join(dir, pkg.name))
        }
      }
    } else {
      packageDirs.push(dir)
      // Workspace roots that host their own packages dir (native builders).
      let nested
      try {
        nested = readdirSync(join(dir, 'packages'), { withFileTypes: true })
      } catch {
        continue
      }
      for (const pkg of nested) {
        if (pkg.isDirectory() && !pkg.name.startsWith('.') && pkg.name !== 'node_modules') {
          packageDirs.push(join(dir, 'packages', pkg.name))
        }
      }
    }
  }
  for (const dir of packageDirs) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    if (typeof manifest.name === 'string' && !index.has(manifest.name)) index.set(manifest.name, dir)
  }
  return index
}

function readStagedManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function collectStagedWorkspacePackages(top) {
  const found = new Map()
  let scopes
  try {
    scopes = readdirSync(top, { withFileTypes: true })
  } catch {
    return found
  }
  const nested = []
  for (const entry of scopes) {
    const dir = join(top, entry.name)
    const manifest = readStagedManifest(dir)
    if (manifest?.name) {
      found.set(manifest.name, { dir, manifest })
      nested.push(join(dir, 'node_modules', '@greeneek'))
    }
  }
  for (const scope of nested) {
    let entries
    try {
      entries = readdirSync(scope, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(scope, entry.name)
      const manifest = readStagedManifest(dir)
      if (manifest?.name && !found.has(manifest.name)) found.set(manifest.name, { dir, manifest })
    }
  }
  return found
}

/** Remove a staging entry left as an absolute symlink by the pruned copy: it would dangle on user machines, so the closure replaces it with a real copy. */
function replaceStagingSymlink(dest) {
  try {
    if (lstatSync(dest).isSymbolicLink()) rmSync(dest, { recursive: true, force: true })
  } catch {
    // Absent or unreadable: the caller re-checks existence.
  }
}

/** Node builtins need no staging: bare imports resolve to core, which shadows any same-named shim exactly as in the source workspace. */
const BUILTIN_DEP_NAMES = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))

/** External (non-`@greeneek`, non-builtin) dependency names a staged manifest may import, mapped to whether any non-optional field declares them. Uninstalled optionals are another platform's build (koffi/landlock impls) and only warn. */
function externalDeps(manifest) {
  const required = new Set()
  const optionalOnly = new Set()
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dep of Object.keys(manifest[field] ?? {})) {
      if (dep.startsWith('@greeneek/') || dep.startsWith('node:') || BUILTIN_DEP_NAMES.has(dep)) continue
      if (field === 'optionalDependencies' && !required.has(dep)) optionalOnly.add(dep)
      else {
        required.add(dep)
        optionalOnly.delete(dep)
      }
    }
  }
  return { required, optionalOnly }
}

/** Whether Node's walk-up from `importerDir` finds `depName` inside staging. */
function resolvesInStaging(staging, importerDir, depName) {
  const parts = depName.split('/')
  let dir = importerDir
  for (;;) {
    if (existsSync(join(dir, 'node_modules', ...parts, 'package.json'))) return true
    if (dir === staging) return false
    const parent = dirname(dir)
    if (parent === dir || relative(staging, parent).startsWith('..')) return false
    dir = parent
  }
}

/** First source directory resolving `depName` from any anchor (workspace layout, store included). */
function findExternalSourceDir(anchors, depName) {
  for (const anchor of anchors) {
    let searchPaths
    try {
      searchPaths = createRequire(anchor).resolve.paths(depName)
    } catch {
      continue
    }
    for (const searchPath of searchPaths ?? []) {
      const candidate = join(searchPath, ...depName.split('/'))
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  return undefined
}

/** Every staged manifest (workspace and external), top level plus one nesting level. Symlinked importers resolve through their source tree, so callers skip nesting under them. */
function collectAllStagedManifests(staging) {
  const found = []
  const topModules = join(staging, 'node_modules')
  const nestedScopes = []
  const visitScope = (scopeDir) => {
    let entries
    try {
      entries = readdirSync(scopeDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const dir = join(scopeDir, entry.name)
      if (entry.name.startsWith('@')) {
        visitScope(dir)
        continue
      }
      const manifest = readStagedManifest(dir)
      if (manifest?.name !== undefined) {
        let symlinked = false
        try {
          symlinked = lstatSync(dir).isSymbolicLink()
        } catch {
          continue
        }
        found.push({ dir, manifest, symlinked })
        nestedScopes.push(join(dir, 'node_modules'))
      }
    }
  }
  visitScope(topModules)
  for (const scope of nestedScopes) visitScope(scope)
  return found
}

/** Exact store copy of an installed external: `<store>/<escaped-name>@<version>/node_modules/<name>`. Falls back to a sorted prefix hit when peers suffix the directory. */
function storeDirFor(stores, depName, version) {
  const escaped = depName.replace('/', '+')
  const exact = `${escaped}@${version}`
  for (const store of stores) {
    if (existsSync(join(store, exact, 'node_modules', ...depName.split('/'), 'package.json'))) {
      return join(store, exact, 'node_modules', ...depName.split('/'))
    }
  }
  for (const store of stores) {
    let entries
    try {
      entries = readdirSync(store)
    } catch {
      continue
    }
    const hit = entries.filter((name) => name === exact || name.startsWith(`${exact}_`)).sort()[0]
    if (hit !== undefined && existsSync(join(store, hit, 'node_modules', ...depName.split('/'), 'package.json'))) {
      console.log(`stage: store fallback ${depName}@${version} → ${hit}`)
      return join(store, hit, 'node_modules', ...depName.split('/'))
    }
  }
  return undefined
}

/** Whether any workspace store carries `depName` at any version: absent everywhere means an unmet peer the source tree itself cannot resolve. */
function installedInStores(stores, depName) {
  const escaped = depName.replace('/', '+')
  for (const store of stores) {
    let entries
    try {
      entries = readdirSync(store)
    } catch {
      continue
    }
    if (entries.some((name) => name.startsWith(`${escaped}@`))) return true
  }
  return false
}

function materializeExternalClosure(staging, repoRoot, workspaceIndex) {
  const skippedOptionals = new Set()
  const skippedUnmetPeers = new Set()
  // Loop-invariant inputs stay in the closure so the per-importer helper keeps three parameters.
  const sourceAnchorsFor = (stagedDir, manifestName, manifestVersion) => {
    const anchors = []
    if (manifestName?.startsWith('@greeneek/') === true) {
      const wsSource = workspaceIndex.get(manifestName)
      if (wsSource !== undefined) anchors.push(join(wsSource, 'package.json'))
    }
    const rel = relative(join(staging, 'node_modules'), stagedDir)
    if (rel !== '' && !rel.startsWith('..')) {
      for (const base of [join(repoRoot, 'apps', 'desktop', 'node_modules'), join(repoRoot, 'node_modules')]) {
        const mapped = join(base, rel)
        if (existsSync(join(mapped, 'package.json'))) {
          anchors.push(join(mapped, 'package.json'))
          try {
            anchors.push(join(realpathSync(mapped), 'package.json'))
          } catch {
            // Non-resolvable link target: the literal anchor already covers it.
          }
          break
        }
      }
    }
    if (manifestName !== undefined && manifestVersion !== undefined && !manifestName.startsWith('@greeneek/')) {
      const stores = [join(repoRoot, 'apps', 'desktop', 'node_modules', '.pnpm'), join(repoRoot, 'node_modules', '.pnpm')]
      const stored = storeDirFor(stores, manifestName, manifestVersion)
      if (stored !== undefined) anchors.push(join(stored, 'package.json'))
    }
    anchors.push(join(repoRoot, 'package.json'), join(repoRoot, 'apps', 'desktop', 'package.json'))
    return anchors
  }
  const stores = [join(repoRoot, 'apps', 'desktop', 'node_modules', '.pnpm'), join(repoRoot, 'node_modules', '.pnpm')]
  for (let round = 0; round < 50; round++) {
    const importers = collectAllStagedManifests(staging)
    let progressed = false
    for (const { dir, manifest, symlinked } of importers) {
      if (symlinked) continue
      const anchors = sourceAnchorsFor(dir, manifest.name, manifest.version)
      const { required, optionalOnly } = externalDeps(manifest)
      for (const dep of new Set([...required, ...optionalOnly])) {
        if (resolvesInStaging(staging, dir, dep)) continue
        const source = findExternalSourceDir(anchors, dep)
        if (source === undefined) {
          if (!required.has(dep)) {
            if (!skippedOptionals.has(dep)) {
              skippedOptionals.add(dep)
              console.log(`stage: skipping uninstallable optional ${dep} (required by ${manifest.name ?? dir})`)
            }
            continue
          }
          // Unmet peers resolve to nothing in the source tree either; warn once and mirror that behavior.
          if (!installedInStores(stores, dep)) {
            if (!skippedUnmetPeers.has(dep)) {
              skippedUnmetPeers.add(dep)
              console.log(`stage: skipping unmet peer ${dep} (required by ${manifest.name ?? dir})`)
            }
            continue
          }
          fail(`staging dropped external ${dep} (required by ${manifest.name ?? dir}) and it is not resolvable from the workspace`)
        }
        const sourceManifest = readStagedManifest(source)
        const topDest = join(staging, 'node_modules', ...dep.split('/'))
        replaceStagingSymlink(topDest)
        const topManifest = readStagedManifest(topDest)
        const dest = topManifest !== undefined && topManifest.version !== sourceManifest?.version
          ? join(dir, 'node_modules', ...dep.split('/'))
          : topDest
        if (existsSync(join(dest, 'package.json'))) continue
        copyDirRecursive(source, dest)
        console.log(`stage: closure materialized external ${dep}@${sourceManifest?.version ?? '?'} (required by ${manifest.name ?? dir})`)
        progressed = true
      }
    }
    if (!progressed) {
      console.log('stage: external closure complete')
      return
    }
  }
  fail('external closure did not converge after 50 rounds')
}

function materializeWorkspaceClosure(staging, workspaceIndex, rootDev) {
  const top = join(staging, 'node_modules', '@greeneek')
  const destFor = (dep) => join(staging, 'node_modules', ...dep.split('/'))
  const skippedOptionals = new Set()
  for (let round = 0; round < 50; round++) {
    const staged = collectStagedWorkspacePackages(top)
    const missing = new Map()
    for (const [name, { manifest }] of staged) {
      const required = new Set()
      const optionalOnly = new Set()
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(manifest[field] ?? {})) {
          if (!dep.startsWith('@greeneek/') || dep === name || staged.has(dep)) continue
          if (existsSync(join(destFor(dep), 'package.json'))) continue
          if (field === 'optionalDependencies' && !required.has(dep)) optionalOnly.add(dep)
          else {
            required.add(dep)
            optionalOnly.delete(dep)
          }
        }
      }
      for (const dep of required) if (!missing.has(dep)) missing.set(dep, { importer: name, required: true })
      for (const dep of optionalOnly) {
        if (missing.has(dep) || existsSync(join(destFor(dep), 'package.json'))) continue
        // Uninstallable optionals (another platform's native build) never join the map, so the fixpoint still converges.
        if (!workspaceIndex.has(dep)) {
          if (!skippedOptionals.has(dep)) {
            skippedOptionals.add(dep)
            console.log(`stage: skipping uninstallable optional ${dep} (required by ${name})`)
          }
          continue
        }
        missing.set(dep, { importer: name, required: false })
      }
    }
    if (missing.size === 0) {
      console.log(`stage: workspace closure complete (${staged.size} packages)`)
      return
    }
    for (const [dep, { importer }] of missing) {
      const source = workspaceIndex.get(dep)
      // Uninstallable optionals never reach this map (filtered above); anything left without a source is a real gap.
      if (!source) fail(`staging dropped ${dep} (required by ${importer}) and it is not a workspace package`)
      const dest = destFor(dep)
      replaceStagingSymlink(dest)
      if (!existsSync(join(dest, 'package.json'))) {
        // Same pruned machinery as the main copy: nested `@greeneek`
        // scopes are skipped (they resolve by walk-up to this top level)
        // while external deps ride along, so the copy stays bounded.
        copyPrunedModules(source, dest, rootDev, new Set(), true, staging)
        const copied = readStagedManifest(dest)
        if (!copied) fail(`staging dropped ${dep} (required by ${importer}): copy produced no manifest`)
        if (copied.main && !existsSync(join(dest, copied.main))) {
          fail(`staged ${dep} is missing its built entry ${copied.main} (run \`pnpm run build\` before staging)`)
        }
        console.log(`stage: closure materialized ${dep} (required by ${importer})`)
      }
    }
  }
  fail('workspace closure did not converge after 50 rounds')
}

function copyLicense(packageDir, staging) {
  let entries = []
  try {
    entries = readdirSync(packageDir)
  } catch {
    return
  }
  const license = entries.find((name) => /^LICENSE/i.test(name))
  if (!license) return
  copyFileSync(join(packageDir, license), join(staging, 'third-party-licenses', `${basename(packageDir)}-${license}`))
}

function renderBuilderConfig(staging) {
  const template = readFileSync(join(packageDir, 'electron-builder.template.yml'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
  const rendered = template.replaceAll('__DESKTOP_VERSION__', manifest.version)
  writeFileSync(join(staging, 'electron-builder.yml'), rendered, 'utf8')
}

function stageKoffiBinary(staging, repoRoot, platform, arch) {
  const archMap = { x64: 'x64', arm64: 'arm64', arm: 'arm', ia32: 'ia32' }
  const koffiArch = archMap[arch] ?? arch
  const pkgName = `@koromix/koffi-${platform}-${koffiArch}`
  const pkgPrefix = `${pkgName.replace('/', '+')}@`
  const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
  let matched
  try {
    matched = readdirSync(pnpmDir).find((name) => name.startsWith(pkgPrefix))
  } catch {
    return
  }
  if (matched === undefined) return
  const sourceDir = join(pnpmDir, matched, 'node_modules', pkgName)
  if (!existsSync(sourceDir)) return
  const entries = readdirSync(sourceDir)
  const triplet = entries.find((name) => statSync(join(sourceDir, name)).isDirectory())
  if (triplet === undefined) return
  const tripletDir = join(sourceDir, triplet)
  const binary = readdirSync(tripletDir).find((name) => statSync(join(tripletDir, name)).isFile() && name.endsWith('.node'))
  if (binary === undefined) return
  const destDir = join(staging, 'node_modules', 'koffi', 'build', 'koffi', triplet)
  mkdirSync(destDir, { recursive: true })
  copyFileSync(join(tripletDir, binary), join(destDir, binary))
  console.log(`stage: koffi native binary ${triplet}/${binary}`)
}

function copySymlink(from, to) {
  let target
  try {
    target = readlinkSync(from)
  } catch {
    return
  }
  if (!target.startsWith('/')) {
    target = join(dirname(from), target)
  }
  try {
    accessSync(target)
  } catch {
    return
  }
  try {
    symlinkSync(target, to)
  } catch {
    copyFileSync(from, to)
  }
}

const isMainModule = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) main()

export { pathContainsSegment, staging }
