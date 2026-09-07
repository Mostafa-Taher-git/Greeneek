import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildGnkArgs,
  buildSpawnEnvironment,
  extractLaunchToken,
  extractReadyUrl,
  isProbeHealthy,
  resolveEnvironmentPathKey,
  updateReadyStability,
  ENTRY_FAILURE_MARKER,
  READY_PATTERN,
} from '../src/gnk-service.js'

describe('gnk-service', () => {
  it('captures the token URL and stops before the LAN suffix', () => {
    const output = 'booting…\ngnk web: http://127.0.0.1:43117/?token=abc123 (LAN: http://192.168.1.4:43117/?token=abc123)\nmore\n'
    assert.equal(extractReadyUrl(output), 'http://127.0.0.1:43117/?token=abc123')
  })

  it('ignores output without a readiness line', () => {
    assert.equal(extractReadyUrl('still booting\n'), undefined)
  })

  it('rejects non-loopback readiness lines', () => {
    assert.equal(extractReadyUrl('gnk web: http://0.0.0.0:3080/?token=x\n'), undefined)
  })

  it('exposes the readiness pattern and entry-failure marker', () => {
    assert.ok(READY_PATTERN instanceof RegExp)
    assert.equal(ENTRY_FAILURE_MARKER, 'GNK entry failed')
  })

  it('extracts the launch token, robust to format drift', () => {
    assert.equal(extractLaunchToken('http://127.0.0.1:1/?token=secret'), 'secret')
    assert.equal(extractLaunchToken('not a url'), undefined)
  })

  it('orders launcher flags before inner app args', () => {
    const args = buildGnkArgs({ nodeEntry: '/app/src/gnk-node-entry.mjs', gnkEntry: '/app/gnk/lib/bin.js' })
    assert.deepEqual(args, [
      '/app/src/gnk-node-entry.mjs',
      '/app/gnk/lib/bin.js',
      '--profile', 'web',
      '--host', '127.0.0.1',
      '--port', '0',
      '--no-open',
    ])
  })

  it('inserts the Windows picker patch only as an overlay', () => {
    const args = buildGnkArgs({
      nodeEntry: '/e',
      gnkEntry: '/g',
      platform: 'win32',
      patch: 'C:\\app\\picker.yml',
    })
    assert.deepEqual(args.slice(2, 6), ['--profile', 'web', '--patch', 'C:\\app\\picker.yml'])
    assert.ok(!args.includes('--trusted-host'))
  })

  it('scrubs loader inheritance and plants the desktop markers', () => {
    const env = buildSpawnEnvironment({
      env: {
        PATH: '/usr/bin', HOME: '/home/u',
        NODE_OPTIONS: '--inspect', NODE_PATH: '/x', ELECTRON_RUN_AS_NODE: '1',
      },
      gnkHome: '/home/u/.gnk-desktop/harness',
      nodeExecutable: '/app/node',
      pnpmEntry: '/app/pnpm.cjs',
      toolDirectory: '/app/assets/bin',
      platform: 'linux',
    })
    assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(env.NODE_PATH, undefined)
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(env.GNK_HOME, '/home/u/.gnk-desktop/harness')
    assert.equal(env.GNK_DESKTOP, '1')
    assert.equal(env.GNK_DESKTOP_NODE_EXECUTABLE, '/app/node')
    assert.equal(env.GNK_DESKTOP_PNPM_CLI, '/app/pnpm.cjs')
    assert.equal(env.NO_COLOR, '1')
    assert.ok(env.PATH.startsWith('/app/assets/bin:'))
  })

  it('looks up PATH case-insensitively on Windows', () => {
    assert.equal(resolveEnvironmentPathKey({ Path: 'C:\\x' }, 'win32'), 'Path')
    assert.equal(resolveEnvironmentPathKey({ path: 'C:\\x' }, 'win32'), 'path')
    assert.equal(resolveEnvironmentPathKey({}, 'win32'), 'Path')
    assert.equal(resolveEnvironmentPathKey({ PATH: '/x' }, 'linux'), 'PATH')
  })

  it('treats 401 as alive-but-unauthenticated, never as failure', () => {
    assert.equal(isProbeHealthy(200, 't'), true)
    assert.equal(isProbeHealthy(302, 't'), true)
    assert.equal(isProbeHealthy(401, 't'), true)
    assert.equal(isProbeHealthy(500, 't'), false)
    assert.equal(isProbeHealthy(200, undefined), false)
  })

  it('holds the stability window across probes', () => {
    let state = updateReadyStability(undefined, true, 1000)
    assert.equal(state.ready, false)
    state = updateReadyStability(state.readySince, true, 1200)
    assert.equal(state.ready, false)
    state = updateReadyStability(state.readySince, true, 1500)
    assert.equal(state.ready, true)
    state = updateReadyStability(state.readySince, false, 1600)
    assert.equal(state.ready, false)
    assert.equal(state.readySince, undefined)
  })
})
