<p align="center">
  <img src="apps/web/public/assets/logo-mark.png" width="88" height="88" alt="Greeneek logo" />
</p>

# Greeneek

[English](README.md) | 中文

<p align="center"><strong>AI 智能体的外科手术工具包。一切皆插件。</strong></p>

<p align="center">
  <a href="https://github.com/Mostafa-Taher-git/Greeneek/actions"><img src="https://img.shields.io/badge/CI-passing-067a52" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-067a52" alt="MIT"></a>
</p>

---

Greeneek 是开源 agent harness（智能体框架）（`gnk`）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

- **运行界面**：Web GUI（`gnk --profile web`）、headless 运行、自动化 ACP 服务器、TypeScript SDK 与 Python SDK。
- **自带模型**：OpenAI、Anthropic、Google 等 35+ 条路由，由你自己的 API 密钥激活。
- **会话与追踪**：持久的会话存储、标题与遥测。
- **可扩展**：每个能力都是插件；为社区插件添加 [`gnk-plugin`](https://github.com/topics/gnk-plugin) 话题。

文档：参见仓库内的[用户指南](docs/user/guide/index.zh.md)与[开发指南](docs/development.zh.md)。

## 品牌与模型

- 应用品牌保持为 **Greeneek**。
- Logo 保持为 **Greeneek**。
- 绿色主题保持为 **Greeneek green**。
- 模型**属于你，而非我们**：本项目不运营任何推理服务，也不自带模型提供方。 每一条模型路由都由你自己的 API 密钥激活。在**设置 → 模型**中添加密钥 （或设置对应的环境变量，例如 `OPENAI_API_KEY`），该提供方即可在各处选用。

## 开发者预览

Greeneek 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @greeneek/gnk web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="desktop-app"></a>

### 桌面端应用

如需安装包（Linux `.deb`/`AppImage`、Windows 安装器/便携版），请从 [GitHub Releases](https://github.com/Mostafa-Taher-git/Greeneek/releases) 下载最新的 `desktop-v*` 版本，并按[桌面端指南](apps/desktop/README.zh.md)操作。桌面端启动的是同一个本地 Web UI，并可从后续版本自更新。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/Mostafa-Taher-git/Greeneek.git
cd Greeneek
pnpm install
pnpm run build
pnpm gnk web
```

`pnpm run build` 会准备仓库产物。`pnpm gnk web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Issues](https://github.com/Mostafa-Taher-git/Greeneek/issues) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`gnk-plugin`](https://github.com/topics/gnk-plugin) 话题，便于被发现。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
