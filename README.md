<p align="center">
  <img src="apps/web/public/assets/logo-mark.png" width="88" height="88" alt="Greeneek logo" />
</p>

# Greeneek

English | [中文](README.zh.md)

<p align="center"><strong>The surgeon's toolkit for AI agents. Everything is a plugin.</strong></p>

<p align="center">
  <a href="https://github.com/Mostafa-Taher-git/Greeneek/actions"><img src="https://img.shields.io/badge/CI-passing-067a52" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-067a52" alt="MIT"></a>
</p>

---

Greeneek is an open-source agent harness (`gnk`).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

- **Surfaces**: Web GUI (`gnk --profile web`), headless runs, automation ACP server, TypeScript SDK, and Python SDK.
- **Bring your own models**: OpenAI, Anthropic, Google, and 35+ other routes, activated by your own API key.
- **Sessions and tracing**: durable session persistence, titles, and telemetry.
- **Extensible**: every capability is a plugin; tag community plugins with the [`gnk-plugin`](https://github.com/topics/gnk-plugin) topic.

Documentation: see the in-repository [user guide](docs/user/guide/index.md) and [development guide](docs/development.md).

## Brand and models

- The app brand stays **Greeneek**.
- The logo stays **Greeneek**.
- The green theme stays **Greeneek green**.
- Models are **yours, not ours**: this project operates no inference service and bundles no model provider. Every model route is activated by your own API key. Add the key under **Settings → Models** (or set the matching environment variable, e.g. `OPENAI_API_KEY`) to use that provider anywhere.

## Developer preview

Greeneek is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @greeneek/gnk web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Desktop app

For an installable app (Linux `.deb`/`AppImage`, Windows installer/portable), download the latest `desktop-v*` release from [GitHub Releases](https://github.com/Mostafa-Taher-git/Greeneek/releases) and follow the [desktop guide](apps/desktop/README.md). The app boots the same local Web UI and self-updates from future releases.

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/Mostafa-Taher-git/Greeneek.git
cd Greeneek
pnpm install
pnpm run build
pnpm gnk web
```

`pnpm run build` prepares the repository artifacts. `pnpm gnk web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Issues](https://github.com/Mostafa-Taher-git/Greeneek/issues).
- Add the [`gnk-plugin`](https://github.com/topics/gnk-plugin) topic to your plugin repository for discoverability.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
