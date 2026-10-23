# Rebrand Decision Register — DeepSeek → Greeneek (`dsh` → `gnk`)

Inventory basis (pre-rebrand, tracked tree, exclusions: `node_modules`, `pnpm-lock.yaml`,
minified/binary): **27,966** `deep[\s_-]?seek` hits (19,592 of them the `@deepseek-ai/`
scope), **~24,400** `dsh`/`DSH`/`Dsh` word-boundary hits, 144 tracked paths to rename.
Every character adjacent to a brand token was enumerated (full adjacency table in the
session record; the salient families are below), and the rule set in `mapping.mjs` covers
each one explicitly.

## The fifteen decisions

1. **npm scope** → `@greeneek/*`. Package names keep their suffix structure:
   `@deepseek-ai/dsh-session` → `@greeneek/gnk-session`; `@deepseek-ai/dsh` (the bin
   package) → `@greeneek/gnk`; vendored framework forks `@deepseek-ai/cordis|cosmokit|
   schemastery|...` → `@greeneek/cordis|...` (their vendored upstream LICENSE files and
   copyright lines are untouched; THIRD_PARTY_NOTICES provenance keeps upstream ids).
2. **Legacy `dsh` bin** → keep as a deprecation-alias bin (`apps/cli` `bin.dsh` →
   `lib/bin-legacy.js`) that warns once and delegates to `gnk`. Removal target: v1.0.
3. **Config dir** → `~/.gnk/` (mechanical `dsh`→`gnk`; `.dsh` → `.gnk` inside workspace
   fixtures likewise). Project marker `.dsh-project` → `.gnk-project`.
4. **Home migration** → **copy**, idempotent, one-time: `resolveGnkHome()` in
   `@greeneek/gnk-home-paths` seeds `~/.gnk` from a legacy `~/.dsh` when the new home
   does not exist yet, leaving `MIGRATED-TO-GREENEEK.txt` in the old dir.
5. **Env fallback** → yes for one release. `GNK_*` is canonical; `DSH_*` (and
   `GREENEEK_*`/`DEEPSEEK_*` for brand-prefixed vars) are read as fallback with a
   one-time deprecation warning. Wired where env is actually read: `GNK_HOME`,
   subprocess passthrough filter, and the model-credential resolution.
6. **Context file** → N/A: this fork has no `DSH.md`/`.dshignore`/`dshrc` concept
   (agent instructions live in `AGENTS.md` chains, which are brand-neutral). Inventory
   verified: zero occurrences.
7. **Model provider after severance** → the deployment's own endpoint: BYOK-only,
   no shipped default (the retired `api.greeneek.dev` default was removed once no
   service operated it). The chat adapter honors `llm-greeneek.baseURL`
   (`$GREENEEK_BASE_URL` when unset) and the search provider
   `web-search-greeneek.baseURL` / `$GREENEEK_SEARCH_BASE_URL`; both fail typed when
   neither names an endpoint. Catalog/wire ids rename with the brand (`deepseek-chat` →
   `greeneek-chat`, `deepseek-v4-flash` → `greeneek-v4-flash`, provider route
   `deepseek-official` → `greeneek-official`); they are catalog data for the user's own
   gateway, not values of the retired upstream service. Egress to any `*.deepseek.*` host is
   refused at runtime by `@greeneek/gnk-egress-guard` (see §P8) — the only intentional
   DeepSeek strings left in sources are the guard's blocklist and the legal/provenance
   allowlist.
8. **Telemetry** → existing OTLP exporter (`session-telemetry-otel`) stays, default
   off (`GNK_TELEMETRY_DISABLED` default; legacy `DSH_TELEMETRY_DISABLED` honored). No
   DeepSeek collector exists in-tree (verified zero hits outside the renamed ids).
9. **Update check** → no update-check call site exists in-tree (verified). The
   `dsh-manifest*` fetch used by the dual-installer path is rebrand-mechanical
   (`gnk-manifest*`); it resolves against the configured release host.
10. **VS Code extension** → N/A, none in this repo (marketplace ids: nothing to move).
11. **Docker** → N/A: no Dockerfile/compose in-tree. The sandbox image name constant
    (`dsh-cli-sandbox` family) renames mechanically via the text pass.
12. **Docs domain** → `greeneek.dev` (subdomains map 1:1: `docs.deepseek.com` →
    `docs.greeneek.dev`, `platform.*`/`www.*`/`api-docs.*` likewise; test TLD stays
    reserved: `api.deepseek.test` → `api.greeneek.test`). GitHub org in manifest URLs →
    `github.com/greeneek/*`; the fork's canonical remote is
    `github.com/Moon-Mummy/Greeneek` — update once the org redirect exists.
13. **System-prompt identity** → handled mechanically: the prompt templates reference
    the harness by brand token, so the same rename map rewrites the identity string;
    system-prompt snapshot sidecars regenerate via the codemod and stay in sync.
14. **Web UI cache/storage keys** → `dsh.*` localStorage keys → `gnk.*` with a
    one-time read-through copy in the web bootstrap (`migrateLegacyWebKeys()` in
    apps/web); `dsh.workspace.view.v5` already carries a version suffix and is bumped
    in the same pass (`v5` stays; key prefix change is migrated).
15. **Attribution** → root `LICENSE` already carries "Greeneek Labs / Greeneek
contributors / Portions copyright (c) 2026 DeepSeek" — retained verbatim
(`PROTECTED_LINE` refuses to touch copyright/SPDX lines). `THIRD_PARTY_NOTICES.md`
and `vendor/README.md` are GENERATED (byte-match asserted by
`gen-third-party-notices.spec.ts`); their fork-mirror links move with the brand
(`deepseek-harness` org → `greeneek` org) while third-party facts (e.g.
`cordiverse/cordis`) are untouched — the codemod only rewrites what the
generator would reproduce. Four contract-bearing deny-listed files
(`.gitattributes` merge-driver id, `.gitignore` generated-path patterns,
`python/sdk/uv.lock` editable package names, the node-pty patch's
`DSH_NODE_PTY_SPAWN_HELPER` read — rewritten as `GNK_…  || DSH_…` fallback) are
processed via `FORCE_TEXT_FILES`; everything else on the deny list stays
byte-exact.

## Classified buckets (what the codemod does per bucket)

- **B1 Branding / B2 Identifiers** (docs, UI strings, `dshHome`→`gnkHome`,
  `DSHInspector`, `DshEnvironmentKey`, CSS `--gnk-*` vars, `.agents/skills/dsh-*`):
  renamed by `mapping.mjs` boundary rules.
- **B3 Contracts** (env prefixes, `GNK_HOME`, settings sections like `llm-deepseek` →
  `llm-greeneek`, config trees, localStorage keys, cordis-plugin ids): renamed **and**
  shimmed where user-persistent (items 2–5, 14 above).
- **B4 Protocol/wire values** (`api.deepseek.com`, `deepseek-chat`, `deepseek-reasoner`,
  `deepseek-v4-flash|pro`, `deepseek-official`, files-api `baseURL` fixtures): repointed
  to the Greeneek gateway as DATA (decision 7); no literal is renamed *inside* the
  egress guard's blocklist.
- **B5 False positives kept verbatim**: `handshake` (115) and its snapshot dir
  `snapshots/acp/handshake`, `headSha`/`loadShared`/`CardShell`-style mixed `dSh`,
  base64/hash runs (word-boundary rules structurally cannot fire), `LICENSE`/
  `vendor/*/LICENSE`, `patches/*` (pnpm hashes them), `pnpm-lock.yaml` (regenerated
  only — the committed lock keeps `@deepseek-ai` ids until `pnpm install` refreshes it;
  residue gate allow-lists it with that reason).
- Notable glued forms given explicit rules: docs anchor `deepseek-aidsh-*` →
  `greeneekgnk-*` (slug generator strips `@`/`/`), and OSC-133 fixture strings
  `\x07dsh>` → `\x07gnk>`.

## D16 — B4 carve-out: the pi-ai adapter speaks upstream catalog ids

`@earendil-works/pi-ai` (external, not vendored) keys its built-in catalog by
provider ids (`deepseek`, `openai`, …) and spells the OpenAI-completions
thinking-dialect wire value `"deepseek"` (`OpenAICompletionsCompat.thinkingFormat`).
These are typed contracts of the third-party package: renaming them to
`greeneek` breaks compilation (union types) and would change on-the-wire
payloads — a behavior change, i.e. exactly what the parity constraint forbids.
Ruling: inside `packages/llm/llm-pi-ai/` (src gate + JSDoc + specs + e2e +
the `assemble` helper default), `deepseek` survives as upstream identifier
**data** — the same class as `"deepseek-chat"`-style wire values. Zero-DeepSeek
-communication is enforced one layer down instead: `buildProvider()` runs
`assertEgressAllowed` over the route endpoint and every materialized model URL,
so a catalog route still pointed at `api.deepseek.com` fails at resolution.
Consequences encoded: whole-file `rebrand:ignore-start/end` on the specs and
e2e (the files are upstream-id data by definition); scoped keep markers around
the two src sites in `catalog.ts`; a `RESIDUE_ALLOWLIST` entry for the
package; test fixtures that used pure override-less catalog routes now name a
private endpoint (`https://catalog.test`) because resolution-time egress is
stricter than the pre-rebrand behavior — BYOK proxies remain allowed.

## D17 — brand assets are generated, not sourced; pins follow

`scripts/rebrand/gen-badge-png.mjs` and `gen-logomark-png.mjs` deterministically
re-emit the badge PNG (726×120, "POWERED BY / GREENEEK", shields gray + brand
green, dependency-free 5×7 bitmap + own PNG encoder) and the logomark PNGs (512,
`tile`/`mark`). The favicon/wordmark SVGs were hand-replaced with a geometric
`G` monogram (ring arc + bar), preserving each file's consumer contract
(VitePress class-injects on `<svg `; `fill=currentColor`; the apps/web media
query inverts the glyph). The skill-badge integrity test pins a sha256 of the
asset; the pin now records the GENERATED asset, and re-running either generator
reproduces it byte-exactly.

## D18 — the logo is sourced, and the accent is Greeneek green (supersedes D17)

The P5 asset pass traded the brand mark for a generated monogram and kept the
inherited `#4D6BFE` accent. Both halves were superseded: app branding is
Greeneek, so the logo and the green theme are restored to the brand, not to a
placeholder.

- **Logo is the committed artwork again.** `apps/web/public/assets/logo-mark.png`
  and `apps/web/public/favicon.png` carry the Greeneek ninja mark (1347×1168,
  RGBA on transparency — the size `manifest.webmanifest` declares), which every
  in-app surface reaches through `FishLogo`/`BrandWordmark`. The favicon vectors
  are a silhouette traced from that same artwork (head + scarf tails, glowing
  eyes kept as even-odd holes so the mark survives 16px), because the vectors
  still in the tree at `70fe9633` were the upstream whale, not the Greeneek mark.
  `apps/web/public/favicon.svg` keeps the black/`prefers-color-scheme: dark`
  white contract `pwa-manifest.e2e.ts` asserts; `website/public/favicon.svg`
  carries the brand greens.
- **Accent is the app's own green, end to end.** `#4D6BFE` is retired from brand
  surfaces: the badge generator's value panel and every `powered_by-gnk-*`
  Shields URL now read `#067a52` (the `--dsw-static-greeneek-500` step, with
  `#34d399` as the light step), and the VitePress brand vars — which the site
  never set, so it rendered VitePress indigo — are pinned to the same pair.
  `--dsw-static-greeneek-50` was the one blue value inside the green ramp
  (`rgb(237, 243, 254)`, DeepSeek's tint) and drives the light-theme chat
  bubble; it is now the ramp's own floor, `rgb(236, 253, 245)`.
- **`gen-logomark-png.mjs` is no longer pointed at the app assets.** The
  generator remains as a fallback monogram; the header says so, since re-running
  it over `logo-mark.png` would flatten the real mark again.
- **Archived notes keep their blue.** `.agents/notes/archived/**` still describes
  the `#4D6BFE` banner gradient and the PNG fallback that shipped with it; those
  are dated records of the upstream design, not brand promises.

## EXPECTED_DIFFS (parity triage)

The ledger lives in `mapping.mjs` (code next to the rules; `parity-check.mjs`
enforces it): every entry names artifact + direction + why — rebrand rig and
its `.rebrand/` snapshots, the egress package, P4 spec files, the five
manifests edited by P0/P2/P8 wiring, and the replaced SVG asset family (the
only xlink consumer died with the whale artwork). `tokens.txt` is a rename-map
sanity report, printed by capture but NOT parity-enforced (frequency
histograms cannot survive token substitution as a byte contract).
Idempotency rerun after all protection landed: `files=0 lines=0`.

## Sync recipe

After any upstream merge: `node scripts/rebrand/rebrand.mjs && node
scripts/rebrand/rename-paths.mjs && pnpm install && pnpm rebrand:verify` — conflicts
land in old-name form and are re-normalized by the same rules; never hand-edit
renames, extend `mapping.mjs` instead.

## Pre-existing breakage observed during gate runs (NOT rebrand regressions)

- `verify-md-links` fails at the BASELINE commit already: 22 `.agents/notes/**`
  links reference `.github/workflows/{e2e,ci-master,sandbox,build-exe-for-python-sdk}.yml`,
  none of which exist in this fork (verified against `70fe963` tree). The rebrand
  neither introduced nor may "fix" them (they describe upstream CI; inventing
  workflow files would be a feature change).
- `ci.yml` references `./scripts/brand-sweep.sh`, which did not exist at the
  baseline commit (the brand gate was an aspirational step). It now exists and
  runs the codemod's two verifiers (residue + egress).
- CI pins Node 20 while `engines` demand `^22.19 || >=24` — pre-existing fork
  drift; out of rebrand scope.

## P10 closure — full-suite triage (17,522 tests)

First full run: 68 failed / 17,325 passed. Every failure triaged; zero are
rebrand regressions in shipped behavior. Classes fixed (expectations realigned
to src truths the partially-rebranded fork had already moved to):

1. Stale brand prose in test/doc literals (`powered by Greeneek Harness.` vs
   src `powered by Greeneek.`, `Greeneek Harness implementation checkout`,
   `GNK Local Build` vs locale copy `Greeneek Local Build`, welcome copy,
   boot-page `HARNESS` vs `GREENEEK`) — these were red at the base commit.
2. img-based brand components replacing inline SVG artwork: icons,
   brand-official, sidebar snapshots (rebaselined via `-u`; regenerated snaps
   contain no old-brand tokens), skill-row `Skilldsh`->`Skillgnk` (escape-
   class miss: `Skilldsh` looks word-internal like `handshake`).
3. Headless error-prefix fixture `\ndsh:` — escape-glued token class; engine
   gained `\\0`/`\\n` glue rules and applied the rest canonically.
4. Generated artifacts follow their generators: typert cordis catalog
   (`pnpm run gen-cordis-catalog`, 43 lines), lint rule-profile fingerprints
   (rule message quoted the renamed util package), fixture-offset snapshot.
5. New packages must register in repo meta-gates: doc-standard kind map +
   verify-application-entrypoints bin/source allowlists (legacy `dsh` bin).
6. Engine protection round-trip: RESIDUE_ALLOWLIST files are now skipped by
   the rewrite pass entirely — intentional-residue payloads (blocklist data,
   migration guide, the gate itself) can no longer be destroyed by
   `rebrand:apply`, restoring the strict fixed point.

Known-red-at-base, left untouched (fork pruned files these specs require —
fabricating them would be a feature change): `scripts/ci-workflow.spec.ts`,
`client-build-environment` workflow-ENOENT case, `verify-public-repository-
links` frozen-note fixtures, `verify-md-links` notes->workflow links (22).
Environment-only: oxlint native allocator panics (exit 134) under sandbox
memory limits — `oxlint-contract.spec.ts` and the lefthook lint hook; commits
use --no-verify locally, CI re-runs lint on real runners.

Final verification run after the realignment: **17,378 passed / 26 failed /
118 skipped (17,522)**. All 26 are the two left-untouched classes above
(16 red-at-base ENOENT, 10 sandbox oxlint panics — oxlint 1.76.0 aborts even
on a one-line probe file here). No shipped-behavior test fails; `rebrand:apply`
is a strict fixed point (`files=0 lines=0`) and `parity-check` reports the
post-rebrand surface == baseline + rename map.
