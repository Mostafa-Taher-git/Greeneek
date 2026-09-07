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
  for (const asset of [
    'src/main.js',
    'src/gnk-service.js',
    'src/gnk-node-entry.mjs',
    'src/gnk-windows-hidden-console.mjs',
    'src/gnk-windows-child-process-hide.mjs',
    'src/startup.html',
    'assets/tray.png',
    'assets/logo-splash.png',
    'assets/bin/pnpm',
    'assets/bin/pnpm.cmd',
    'LICENSE',
  ]) {
    copyFileEnsureDir(join(packageDir, asset), join(staging, asset))
  }
  mkdirSync(join(staging, 'third-party-licenses'), { recursive: true })

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
          const nestedIsWorkspace = targetReal.includes('/packages/') || targetReal.includes('/vendor/') || targetReal.includes('/node_modules/.pnpm/')
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
                  const isExternalPkg = innerTargetReal.includes('/node_modules/.pnpm/')
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
                    const nestedIsWorkspace = innerTargetReal.includes('/packages/') || innerTargetReal.includes('/vendor/')
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

export { staging }
