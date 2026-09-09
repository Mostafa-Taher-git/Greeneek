# Greeneek Desktop


Installable Electron shell for Greeneek. Boots the local `gnk web` service on a random loopback port, shows the branded splash, enforces single-instance + tray, persists user data outside the install dir, and self-updates from GitHub Releases.

## Download

- Linux `.deb` and `AppImage`: [greeneek.vercel.app](https://greeneek.vercel.app/#download)
- Install guide: [docs/user/guide/desktop.md](../../docs/user/guide/desktop.md)

## Install

### Linux

- `.deb`: double-click or `sudo apt install ./Greeneek-Desktop-*.deb`
- `AppImage`: `chmod +x Greeneek-Desktop-*.AppImage && ./Greeneek-Desktop-*.AppImage`

### Windows

- NSIS installer: `Greeneek-Desktop-*.exe`
- Portable: unzip `Greeneek-Desktop-*.zip`

## First run

Greeneek Desktop starts the bundled service, opens the window, and writes logs under the platform user-data dir. The tray icon keeps the app running after close.

## Self-update

- NSIS + AppImage: full update from GitHub Releases.
- `.deb` + portable ZIP: update notification only; install from the downloaded artifact.

## Development

```bash
pnpm install
pnpm --filter @greeneek/desktop run start
pnpm --filter @greeneek/desktop run test
```

## Release

Tag format: `desktop-v0.1.0`. The `desktop.yml` and `desktop-windows.yml` workflows build Linux `.deb` + `AppImage` and Windows NSIS + ZIP, upload artifacts, and create a GitHub Release with `-latest-` aliases.
