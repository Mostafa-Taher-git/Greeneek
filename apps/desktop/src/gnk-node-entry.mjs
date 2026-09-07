import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { enforceWindowsChildProcessHide } from './gnk-windows-child-process-hide.mjs'

/**
 * Child entry wrapper: the desktop spawns the bundled real Node on this file,
 * which sets up the Windows console discipline and then imports the real CLI.
 * It lives inside the app dir next to `node_modules` so the bare `koffi`
 * import below resolves; staging it anywhere else breaks module resolution.
 * The child is always real Node (never Electron), so no `ELECTRON_RUN_AS_NODE`
 * dance is needed — the service scrubs that variable from the child env.
 */

const [gnkEntryPath, ...gnkArguments] = process.argv.slice(2)

function report(label, value) {
  process.stderr.write(`[gnk-node] ${label}: ${value}\n`)
}

process.on('uncaughtException', (error) => report('uncaught exception', error?.stack ?? error))
process.on('unhandledRejection', (error) => report('unhandled rejection', error?.stack ?? error))

process.stdout.write(
  `[gnk-node] runtime node=${process.version} platform=${process.platform} arch=${process.arch}\n`,
)
process.stdout.write(`[gnk-node] execPath=${process.execPath}\n`)
process.stdout.write(`[gnk-node] cwd=${process.cwd()}\n`)
process.stdout.write(`[gnk-node] GNK_HOME=${process.env.GNK_HOME ?? ''}\n`)

// The service spawns console-less (detached + windowsHide), so console apps
// the agent goes on to launch (pwsh, git, ripgrep) would flash their own
// window unless the process owns a hidden console for them to inherit.
// Patching child_process before the entry loads catches every spawn in the
// tree — harness internals and third-party plugins alike. A caller that
// explicitly sets windowsHide keeps its own choice.
if (process.platform === 'win32') {
  const { createHiddenConsole } = await import('./gnk-windows-hidden-console.mjs')
  createHiddenConsole()

  enforceWindowsChildProcessHide(childProcess, syncBuiltinESMExports)

  process.stdout.write('[gnk-node] windowsHide enforcement enabled for child processes\n')
}

if (!gnkEntryPath) {
  report('startup error', 'missing gnk entry path')
  process.exitCode = 1
} else {
  process.stdout.write(`[gnk-node] loading=${gnkEntryPath}\n`)
  process.argv = [process.execPath, gnkEntryPath, ...gnkArguments]
  try {
    await import(pathToFileURL(gnkEntryPath).href)
    process.stdout.write('[gnk-node] gnk entry loaded\n')
  } catch (error) {
    report('GNK entry failed', error?.stack ?? error)
    process.exitCode = 1
  }
}
