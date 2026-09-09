# 安装 Greeneek 桌面端

[English](desktop.md) | 中文

Greeneek 桌面端是 Greeneek Web UI 的可安装封装。当你想要任务栏或启动器中的固定图标、离线友好的启动方式，或与浏览器标签页相互独立的本地安装时，可以使用它。

## 下载

当前可用的 Linux 安装包如下。

- `deb`：[Greeneek Desktop `.deb`](https://www.greeneek.duckdns.org/downloads/greeneek-desktop-latest-amd64.deb)
- `AppImage`：[Greeneek Desktop `AppImage`](https://www.greeneek.duckdns.org/downloads/greeneek-desktop-latest-amd64.AppImage)

Windows 安装程序和便携版尚未发布。

## 在 Linux 上安装

### deb

```sh
sudo apt install ./greeneek-desktop-*.deb
```

### AppImage

```sh
chmod +x greeneek-desktop-*.AppImage
./greeneek-desktop-*.AppImage
```

## 更新

使用新版本安装包重新执行相同的安装命令即可。桌面端数据存放在应用的本地存储目录下，因此更新不需要手动迁移。

## 故障排查

- 如果关闭应用后启动器图标没有出现，请注销后重新登录，或执行你所用版本发布说明中的桌面集成命令。
- 如果更新没有自动生效，请手动安装新版本安装包。
