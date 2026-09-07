import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Stage a self-contained app dir for electron-builder: `pnpm deploy --prod`
 * the desktop package (workspace symlinks become real files honoring every
 * `files` list), assert the runtime closure, apply platform fixups, and
 * render the builder config. Idempotent; runnable locally and in CI.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageDir, '..', '..')
const staging = join(packageDir, '.staging', 'app')

function fail(message) {
  console.error(`stage: ${message}`)
  process.exit(1)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
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

  // 2. Deploy the production closure.
  console.log(`stage: pnpm deploy → ${staging}`)
  run('pnpm', ['--filter', '@greeneek/desktop', 'deploy', staging, '--prod'], repoRoot)

  const gnkEntry = assertPresent(
    join(staging, 'node_modules', '@greeneek', 'gnk', 'lib', 'bin.js'),
    'deploy dropped the CLI entry; check @greeneek/gnk `files`',
  )
  assertPresent(
    join(staging, 'node_modules', '@greeneek', 'gnk-web-frontend', 'dist', 'index.html'),
    'deploy dropped the frontend; check @greeneek/gnk-web-frontend `files`',
  )
  const pnpmCandidates = ['pnpm.cjs', 'pnpm.mjs']
    .map((file) => join(staging, 'node_modules', 'pnpm', 'bin', file))
    .filter((file) => existsSync(file))
  if (pnpmCandidates.length === 0) fail('deploy dropped the pnpm CLI')
  console.log(`stage: gnk entry ${gnkEntry}`)
  console.log(`stage: pnpm entry ${pnpmCandidates[0]}`)
  assertPresent(join(staging, 'node_modules', 'electron-updater', 'out', 'AppUpdater.js'), 'deploy dropped electron-updater')
  assertPresent(join(staging, 'node_modules', 'koffi'), 'deploy dropped koffi (it must be a direct dependency)')
  try {
    run(process.execPath, ['-e', `import('koffi').then(() => console.log('stage: koffi loads'))`], staging)
  } catch {
    fail('koffi does not load from staging')
  }

  // 3. Runtime assets the `files` list carries.
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
    'package.json',
    'LICENSE',
  ]) {
    assertPresent(join(staging, asset), 'deploy dropped a desktop runtime file; check @greeneek/desktop `files`')
  }
  mkdirSync(join(staging, 'third-party-licenses'), { recursive: true })

  // 4. Bundled-node probe: executable, matching platform/arch.
  const nodeBinary = join(staging, 'node_modules', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
  assertPresent(nodeBinary, 'the `node` package did not deploy its binary (install with lifecycle scripts enabled)')
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

  // 5. The entry wrapper loads under the staged node (no-arg run must exit
  // with the usage error, proving the wrapper plus its koffi chain resolve).
  const wrapper = spawnSync(nodeBinary, [join(staging, 'src', 'gnk-node-entry.mjs')], { encoding: 'utf8' })
  const wrapperOut = `${wrapper.stdout || ''}${wrapper.stderr || ''}`
  if (wrapper.status === 0 || !wrapperOut.includes('missing gnk entry path')) {
    fail(`entry wrapper misbehaves under staged node (status ${wrapper.status}):\n${wrapperOut}`)
  }
  console.log('stage: entry wrapper loads under staged node')

  // 6. Linux fixups: packaged pty works without rebuild; landlock keeps +x.
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

  // 7. Third-party licenses for the bundled runtimes.
  copyLicense(join(staging, 'node_modules', 'node'), staging)
  copyLicense(join(staging, 'node_modules', 'koffi'), staging)
  copyLicense(join(staging, 'node_modules', 'pnpm'), staging)

  // 8. Build icons into staging buildResources.
  mkdirSync(join(staging, 'assets'), { recursive: true })
  copyFileSync(join(packageDir, 'assets', 'icon.png'), join(staging, 'assets', 'icon.png'))
  copyFileSync(join(packageDir, 'assets', 'icon.ico'), join(staging, 'assets', 'icon.ico'))

  // 9. Shim line-endings and exec bit.
  const shim = join(staging, 'assets', 'bin', 'pnpm')
  try {
    chmodSync(shim, 0o755)
  } catch {
    fail(`cannot chmod the pnpm shim: ${shim}`)
  }

  // 10. Render the builder config.
  renderBuilderConfig(staging)
  console.log(`stage: complete → ${staging}`)
}

function accessCheck(path) {
  accessSync(path, constants.X_OK)
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

const isMainModule = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) main()

export { staging }
