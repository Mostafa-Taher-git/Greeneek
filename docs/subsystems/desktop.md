# Greeneek Desktop


Greeneek Desktop is an installable Electron shell that hosts the existing Greeneek web UI without forking or patching it. It boots the local `gnk web` service, opens a branded window, and manages lifecycle concerns outside the browser: single-instance lock, tray, splash/startup page, security policy, stale auth-cookie cleanup, pinned store location, and consent-based self-updates from GitHub Releases.

## Runtime contract

- **Entry**: `apps/desktop/src/main.js`
- **Service wrapper**: `apps/desktop/src/gnk-service.js`
- **Windows no-console shim**: `apps/desktop/src/gnk-node-entry.mjs`
- **Bundled runtimes**: Node.js from the `node` npm package, pnpm from `pnpm`, koffi for native interop
- **Self-update**: `apps/desktop/src/updater.js` with `electron-updater`
- **Safe mode**: `apps/desktop/src/boot-health.js` counts consecutive service failures; after three, the next launch boots with `GNK_SAFE_MODE=1`, and `apps/cli/src/profile-boot.ts` skips every user layer so only core bundles load
- **Tests**: `apps/desktop/test/*.test.js` with Node's built-in test runner

## Supported installers

- Linux x64: `.deb` and `AppImage`
- Windows x64: NSIS installer and portable ZIP

## Packaging

`pnpm --filter @greeneek/desktop run dist:linux` stages the app and builds Linux artifacts. `dist:win` builds Windows artifacts. Release workflows in `.github/workflows/desktop.yml` and `.github/workflows/desktop-windows.yml` publish tagged builds to GitHub Releases with `-latest-` aliases.

## Safe mode

After three consecutive service failures the desktop retries with `GNK_SAFE_MODE=1`, which boots core bundles only: the profile layer, the home layer, and `--patch` overlays are skipped while the telemetry switch stays honored. A successful boot clears the counter. Disable the broken plugin in Settings, then restart to leave safe mode.
