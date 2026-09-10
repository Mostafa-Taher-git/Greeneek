# Install Greeneek Desktop

Greeneek Desktop is an installable Electron shell that boots the Greeneek Web UI locally. Use it when you want a persistent taskbar/launcher icon, offline-friendly launch, or a standalone local install separate from a browser tab.

## Download

Every download link below points at the latest published desktop release, so the links never change between versions.

Platform | Package | Link
--- | --- | ---
Linux x64 | `deb` | [Greeneek-Desktop-latest-linux-amd64.deb](https://github.com/Mostafa-Taher-git/Greeneek/releases/latest/download/Greeneek-Desktop-latest-linux-amd64.deb)
Linux x64 | `AppImage` | [Greeneek-Desktop-latest-linux-x86_64.AppImage](https://github.com/Mostafa-Taher-git/Greeneek/releases/latest/download/Greeneek-Desktop-latest-linux-x86_64.AppImage)
Windows x64 | installer | [Greeneek-Desktop-latest-windows-x64.exe](https://github.com/Mostafa-Taher-git/Greeneek/releases/latest/download/Greeneek-Desktop-latest-windows-x64.exe)
Windows x64 | portable | [Greeneek-Desktop-latest-windows-x64.zip](https://github.com/Mostafa-Taher-git/Greeneek/releases/latest/download/Greeneek-Desktop-latest-windows-x64.zip)

macOS builds are not published yet. All release artifacts are also listed on the [releases page](https://github.com/Mostafa-Taher-git/Greeneek/releases).

## Install on Linux

### deb

```sh
sudo apt install ./Greeneek-Desktop-latest-linux-amd64.deb
```

### AppImage

```sh
chmod +x Greeneek-Desktop-latest-linux-x86_64.AppImage
./Greeneek-Desktop-latest-linux-x86_64.AppImage
```

## Install on Windows

1. Download the `.exe` installer and run it, or unpack the `.zip` portable build and run `Greeneek Desktop.exe` from it.
2. Follow the installation wizard; launch Greeneek from the Start Menu or Desktop.

Portable copies do not self-update: run the installer for the newer version, or download a fresh portable build.

## Update

Installed builds check GitHub Releases after startup and every six hours. An available update is offered before anything downloads; installation begins only when you choose restart-and-install, and one version can be skipped without suppressing later ones.

- `deb` installs update through the package manager: re-run the install command with the newer package.
- `AppImage` and installed Windows builds self-update from GitHub Releases.
- Desktop data lives outside the install directory, so an update does not require manual migration.

## Troubleshooting

- If the launcher icon does not appear after closing the app, log out and back in, or run the desktop integration command included in the release notes for your version.
- If updates do not apply automatically, install the newer package manually.
