# `@greeneek/gnk`


The `gnk` command is the sole supported Node application launcher: profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides. SDK and ACP are profiles, not separate public bins. The Python runtime wheel packages this same command; the SDK defaults to `sdk`, and the minimal example selects `sdk-minimal`. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `gnk --profile <name>` | Boot the named profile under `$GNK_HOME/profiles/<name>`. |
| `gnk --profile acp` | Serve automation clients over ACP stdio until disconnect. |
| `gnk --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `gnk --profile sdk` | Serve SDK clients over JSON-RPC stdio until shutdown or disconnect. |
| `gnk --profile sdk-minimal` | Serve SDK clients with the standalone minimal agent tree. |
| `gnk web` | Alias of `--profile web`. |
| `gnk plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` profiles auto-initialize on first use from shipped templates; any other profile must be created through `gnk plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`gnk-cmdline`](../../packages/boot/cmdline/README.md)). The first token the launcher does not recognize starts the app's arguments:

```sh
gnk --profile web --port 8080       # --port belongs to the web app
gnk --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
gnk --profile headless "run the tests"
gnk --profile web --help            # the web app's flags, not the launcher's
gnk --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `gnk.profile` with its ordered `bundles` list and `patchReload` lifecycle) and a `cordis.patch.yml` (the user's own patch layer). `patchReload: live` watches the profile and home-level patch files; `startup` applies them once.

The tree composes over an empty root:
- each bundle's patch in `gnk.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$GNK_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `gnk.profile.bundles` resolve from the gnk installation first (`@greeneek/gnk-base`, `@greeneek/gnk-web-app`, `@greeneek/gnk-headless`, `@greeneek/gnk-sdk-app`, `@greeneek/gnk-sdk-minimal`, `@greeneek/gnk-acp-app`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Optional overlays

`config/examples/` ships opt-in overlays for GitHub review webhooks, session-local Schedule, memory MCP servers, and runtime Cordis tools. They are never part of a default profile; the [user guides](../../docs/user/guide/index.md) and [developer practice guides](../../docs/user/develop/practice/index.md) own setup and safety instructions.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm gnk <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
