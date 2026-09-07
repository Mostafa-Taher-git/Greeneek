# Greeneek Desktop（中文）

Greeneek Desktop 是一个可安装的 Electron 壳，用于承载现有 Greeneek Web UI，不进行 fork 或修改。它会在本地启动 `gnk web` 服务、打开品牌化窗口，并处理浏览器之外的生命周期事项：单实例锁、托盘、启动页/闪屏、安全策略、过期 auth cookie 清理、固定 store 路径，以及基于 GitHub Releases 的同意式自更新。

## 运行时约定

- **入口**：`apps/desktop/src/main.js`
- **服务包装**：`apps/desktop/src/gnk-service.js`
- **Windows 无控制台垫片**：`apps/desktop/src/gnk-node-entry.mjs`
- **打包运行时**：来自 `node` npm 包的 Node.js、来自 `pnpm` 的 pnpm、以及用于原生交互的 koffi
- **自更新**：`apps/desktop/src/updater.js`，基于 `electron-updater`
- **测试**：`apps/desktop/test/*.test.js`，使用 Node 内置测试运行器

## 支持的安装包

- Linux x64：`.deb` 和 `AppImage`
- Windows x64：NSIS 安装器和便携 ZIP

## 打包

`pnpm --filter @greeneek/desktop run dist:linux` 会暂存应用并构建 Linux 产物。`dist:win` 构建 Windows 产物。`.github/workflows/desktop.yml` 与 `.github/workflows/desktop-windows.yml` 负责将 tagged build 发布到 GitHub Releases，并生成 `-latest-` 别名。
