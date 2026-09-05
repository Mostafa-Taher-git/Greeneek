# Migrating from DeepSeek Harness (`dsh`) to Greeneek Harness (`gnk`)

English | [中文](migration-from-deepseek.zh.md)

This document is the exhaustive old→new name map for the rebrand. Names not listed here changed by the mechanical rule: brand token `deepseek`→`greeneek` and short name `dsh`→`gnk`, at every capitalization (`DSH`→`GNK`, `Dsh`→`Gnk`, `DeepSeek`→`Greeneek`, `DEEPSEEK`→`GREENEEK`).

> Legal note: the MIT license text and copyright notices are retained verbatim (see `LICENSE`); renaming branding is required by trademark law, removing attribution is not allowed. Nothing here changes those terms.

## One-time transitions (automatic)

| Legacy state | What happens on first Greeneek launch |
| --- | --- |
| `~/.dsh/` exists, `~/.gnk/` does not | Copied to `~/.gnk` (copy, never move); `MIGRATED-TO-GREENEEK.txt` left behind — safe to delete after verification |
| `$DSH_HOME` set | Still selects the home, with a one-line deprecation warning; set `$GNK_HOME` instead. Ignored when `$GNK_HOME` is present |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_SEARCH_BASE_URL` in env or `.env` | Resolved as fallbacks for `GREENEEK_API_KEY` / `GREENEEK_BASE_URL` / `GREENEEK_SEARCH_BASE_URL` with a warning; legacy values never shadow current ones |
| `dshHome:` in a `cordis.yml` / settings section | Read as a fallback for `gnkHome:` |
| `DSH_*` managed variables in child environments | Still scrubbed from spawned subprocess environments |
| Browser `localStorage` keys `dsh.*` | Read-through copied to `gnk.*` on first access; legacy entries are kept so a rollback still works |
| `DSH_NODE_PTY_SPAWN_HELPER` | Honored by the node-pty spawn helper seam (`GNK_NODE_PTY_SPAWN_HELPER` takes precedence) |

All fallbacks are removed in **v1.0**.

## Renamed surfaces

| Surface | Old | New |
| --- | --- | --- |
| Binary | `dsh` | `gnk` (the deprecated `dsh` alias launcher was removed in v1.0) |
| npm scope | `@deepseek-ai/dsh-*` | `@greeneek/gnk-*` |
| CLI package | `@deepseek-ai/dsh` | `@greeneek/gnk` |
| Home directory | `~/.dsh` | `~/.gnk` |
| Home override env | `DSH_HOME` | `GNK_HOME` |
| Env prefix (managed) | `DSH_` | `GNK_` |
| Credential/model env | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_SEARCH_BASE_URL` | `GREENEEK_API_KEY`, `GREENEEK_BASE_URL`, `GREENEEK_SEARCH_BASE_URL` |
| Snapshot harness env | `DSH_SNAPSHOT*` | `GNK_SNAPSHOT*` |
| Telemetry switch | `DSH_TELEMETRY_DISABLED` | `GNK_TELEMETRY_DISABLED` |
| Project marker | `.dsh-project` | `.gnk-project` |
| Provider route id | `deepseek-official` | `greeneek-official` |
| Model ids | `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp` | `greeneek-chat`, `greeneek-reasoner`, `greeneek-v4-flash`, `greeneek-v4-pro`, `greeneek-v4-flash-vision-exp` |
| Gateway endpoint | `https://api.deepseek.com` (chat), `https://api.deepseek.com/anthropic/v1` (search) | No hosted gateway — bring your own Greeneek-protocol endpoint and key (BYOK-only). Point `GREENEEK_BASE_URL` / `GREENEEK_SEARCH_BASE_URL` at an endpoint the deployment operates; shipped profiles mount no official provider |
| Docs site | `docs.deepseek.com` | No hosted docs site — read the docs in this repository (`docs/`, package READMEs) |
| Settings section keys | `llm-deepseek`, `web-search-deepseek`, … | `llm-greeneek`, `web-search-greeneek`, … |
| Python SDK | `deepseek-harness-sdk` (`deepseek_harness`) | `greeneek-harness-sdk` (`greeneek_harness`) |
| Python runtime | `deepseek-harness-runtime-bin` (`deepseek_harness_runtime`) | `greeneek-harness-runtime-bin` (`greeneek_harness_runtime`) |
| Web CSS custom properties | `--dsh-*` | `--gnk-*` |
| Browser storage keys | `dsh.theme`, `dsh.locale`, `dsh.sessions.current`, `dsh.conversation*`, `dsh.workspace.view.v5`, `dsh.trajectory.duration` | `gnk.*` equivalents (auto-migrated) |
| Git merge driver | `merge.dsh-translation-pairing` | `merge.gnk-translation-pairing` |

## Updating a machine by hand (instead of relying on the fallbacks)

```bash
mv ~/.dsh ~/.gnk                       # or let the first launch copy it
sed -i 's/^DSH_/GNK_/; s/DEEPSEEK_/GREENEEK_/' ~/.gnk/.env    # if you keep a .env
# rename settings sections: `llm-deepseek:` -> `llm-greeneek:` in cordis.yml / settings.yaml
# session-persisted model selections stored the old ids (deepseek-official /
# deepseek-chat): re-pick a model once on the affected session; the stored
# value is then rewritten to the greeneek-* ids.
```

## What did not change

- Every command, flag, subcommand, tool, setting key family, and theme (parity is machine-checked: `pnpm rebrand:parity`).
- The MIT license and third-party attributions (`LICENSE`, `THIRD_PARTY_NOTICES.md`, vendored `LICENSE` files).
- Wire protocol shape: the adapter remains OpenAI-compatible chat-completions (plus the files API and the Anthropic-compatible search endpoint) — only its canonical host placeholder and catalog ids are Greeneek's. The placeholder host names no operated service: always configure a reachable endpoint.
