# Install Greeneek Desktop

English | [中文](desktop.zh.md)

Greeneek Desktop is an installable wrapper for the Greeneek Web UI. Use it when you want a persistent taskbar/launcher icon, offline-friendly launch, or a standalone local install separate from a browser tab.

## Download

Current Linux packages are available below.

- `deb`: [Greeneek Desktop `.deb`](https://www.greeneek.duckdns.org/downloads/greeneek-desktop-latest-amd64.deb)
- `AppImage`: [Greeneek Desktop `AppImage`](https://www.greeneek.duckdns.org/downloads/greeneek-desktop-latest-amd64.AppImage)

Windows installers and portable builds are not published yet.

## Install on Linux

### deb

```sh
sudo apt install ./greeneek-desktop-*.deb
```

### AppImage

```sh
chmod +x greeneek-desktop-*.AppImage
./greeneek-desktop-*.AppImage
```

## Update

Re-run the same install command with a newer package. Desktop data lives under the app's local storage directory, so an update does not require manual migration.

## Troubleshooting

- If the launcher icon does not appear after closing the app, log out and back in, or run the desktop integration command included in the release notes for your version.
- If updates do not apply automatically, install the newer package manually.
