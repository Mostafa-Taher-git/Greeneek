# Greeneek Desktop

[English](README.md) | 中文

Greeneek 的桌面安装壳。本地启动 `gnk web` 服务、展示品牌启动页、单实例 + 托盘、用户数据持久化在安装目录外，并从 GitHub Releases 自更新。

## 安装

### Linux

- `.deb`：双击或 `sudo apt install ./Greeneek-Desktop-*.deb`
- `AppImage`：`chmod +x Greeneek-Desktop-*.AppImage && ./Greeneek-Desktop-*.AppImage`

### Windows

- NSIS 安装器：`Greeneek-Desktop-*.exe`
- 便携版：解压 `Greeneek-Desktop-*.zip`

## 首次运行

桌面端会启动内置服务、打开窗口，并在平台用户数据目录写入日志。关闭窗口后托盘图标保持后台运行。

## 自更新

- NSIS + AppImage：完整更新。
- `.deb` + 便携 ZIP：仅通知更新；从下载产物手动安装。

## 开发

```bash
pnpm install
pnpm --filter @greeneek/desktop run start
pnpm --filter @greeneek/desktop run test
```

## 发布

Tag 格式：`desktop-v0.1.0`。`desktop.yml` 与 `desktop-windows.yml` 会构建 Linux `.deb` + `AppImage` 以及 Windows NSIS + ZIP，上传制品，并在 GitHub Releases 生成 `-latest-` 别名。
