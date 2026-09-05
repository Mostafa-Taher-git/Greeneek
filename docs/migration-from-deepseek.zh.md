# 从 DeepSeek Harness（`dsh`）迁移到 Greeneek Harness（`gnk`）

[English](migration-from-deepseek.md) | 中文

本文是品牌迁移的完整旧→新名称对照表。未列出的名称均按机械规则变化：品牌 token `deepseek`→`greeneek`、短名 `dsh`→`gnk`，覆盖全部大小写形式（`DSH`→`GNK`、`Dsh`→`Gnk`、`DeepSeek`→`Greeneek`、`DEEPSEEK`→`GREENEEK`）。

> 法律说明：MIT 许可证文本与版权声明按原样保留（见 `LICENSE`）；重命名品牌标识是商标法的要求，而移除署名不是被允许的。本文不改变上述条款。

## 一次性自动迁移

| 旧状态 | Greeneek 首次启动时的行为 |
| --- | --- |
| `~/.dsh/` 存在而 `~/.gnk/` 不存在 | 复制到 `~/.gnk`（只复制、绝不移动）；在原目录留下 `MIGRATED-TO-GREENEEK.txt` 提示——确认无误后可安全删除旧目录 |
| 设置了 `$DSH_HOME` | 仍可选择 home，并打印一行弃用警告；请改用 `$GNK_HOME`。当 `$GNK_HOME` 存在时被忽略 |
| 环境或 `.env` 中的 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_SEARCH_BASE_URL` | 作为 `GREENEEK_API_KEY` / `GREENEEK_BASE_URL` / `GREENEEK_SEARCH_BASE_URL` 的回退被解析并给出警告；旧值永不遮蔽当前值 |
| `cordis.yml` / settings 段中的 `dshHome:` | 作为 `gnkHome:` 的回退被读取 |
| 子进程环境中的 `DSH_*` 受管变量 | 仍会从派生子进程的环境中清除 |
| 浏览器 `localStorage` 键 `dsh.*` | 首次访问时读穿并复制为 `gnk.*`；旧键保留以保证回滚可用 |
| `DSH_NODE_PTY_SPAWN_HELPER` | node-pty spawn helper 接缝仍识别它（`GNK_NODE_PTY_SPAWN_HELPER` 优先） |

所有回退在 **v1.0** 移除。

## 被重命名的表面

| 表面 | 旧 | 新 |
| --- | --- | --- |
| 可执行文件 | `dsh` | `gnk`（弃用的 `dsh` 别名启动器已在 v1.0 移除） |
| npm 作用域 | `@deepseek-ai/dsh-*` | `@greeneek/gnk-*` |
| CLI 包 | `@deepseek-ai/dsh` | `@greeneek/gnk` |
| Home 目录 | `~/.dsh` | `~/.gnk` |
| Home 覆盖环境变量 | `DSH_HOME` | `GNK_HOME` |
| 环境变量前缀（受管） | `DSH_` | `GNK_` |
| 凭据/模型环境变量 | `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL` | `GREENEEK_API_KEY`、`GREENEEK_BASE_URL`、`GREENEEK_SEARCH_BASE_URL` |
| 快照 harness 环境变量 | `DSH_SNAPSHOT*` | `GNK_SNAPSHOT*` |
| 遥测开关 | `DSH_TELEMETRY_DISABLED` | `GNK_TELEMETRY_DISABLED` |
| 项目标记 | `.dsh-project` | `.gnk-project` |
| 提供方路由 id | `deepseek-official` | `greeneek-official` |
| 模型 id | `deepseek-chat`、`deepseek-reasoner`、`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp` | `greeneek-chat`、`greeneek-reasoner`、`greeneek-v4-flash`、`greeneek-v4-pro`、`greeneek-v4-flash-vision-exp` |
| 网关端点 | `https://api.deepseek.com`（chat）、`https://api.deepseek.com/anthropic/v1`（search） | 无托管网关——自带 Greeneek 协议端点与密钥（仅 BYOK）。将 `GREENEEK_BASE_URL` / `GREENEEK_SEARCH_BASE_URL` 指向部署自己运营的端点；随附 profile 不挂载任何官方提供方 |
| 文档站 | `docs.deepseek.com` | 无托管文档站——请阅读本仓库内的文档（`docs/`、各包 README） |
| 设置段键 | `llm-deepseek`、`web-search-deepseek`、… | `llm-greeneek`、`web-search-greeneek`、… |
| Python SDK | `deepseek-harness-sdk`（`deepseek_harness`） | `greeneek-harness-sdk`（`greeneek_harness`） |
| Python 运行时 | `deepseek-harness-runtime-bin`（`deepseek_harness_runtime`） | `greeneek-harness-runtime-bin`（`greeneek_harness_runtime`） |
| Web CSS 自定义属性 | `--dsh-*` | `--gnk-*` |
| 浏览器存储键 | `dsh.theme`、`dsh.locale`、`dsh.sessions.current`、`dsh.conversation*`、`dsh.workspace.view.v5`、`dsh.trajectory.duration` | `gnk.*` 对应键（自动迁移） |
| Git 合并驱动 | `merge.dsh-translation-pairing` | `merge.gnk-translation-pairing` |

## 手动迁移一台机器（不依赖回退）

```bash
mv ~/.dsh ~/.gnk                       # or let the first launch copy it
sed -i 's/^DSH_/GNK_/; s/DEEPSEEK_/GREENEEK_/' ~/.gnk/.env    # if you keep a .env
# rename settings sections: `llm-deepseek:` -> `llm-greeneek:` in cordis.yml / settings.yaml
# session-persisted model selections stored the old ids (deepseek-official /
# deepseek-chat): re-pick a model once on the affected session; the stored
# value is then rewritten to the greeneek-* ids.
```

## 未变化的部分

- 每一条命令、选项、子命令、工具、设置键族与主题（奇偶性由机器校验：`pnpm rebrand:parity`）。
- MIT 许可证与第三方署名（`LICENSE`、`THIRD_PARTY_NOTICES.md`、vendored `LICENSE` 文件）。
- 线协议形态：适配器仍是 OpenAI 兼容的 chat-completions（外加 files API 与 Anthropic 兼容的 search 端点）——只有其规范主机占位符与目录 id 归属 Greeneek。该占位主机不指向任何运营中的服务：务必配置可达端点。
