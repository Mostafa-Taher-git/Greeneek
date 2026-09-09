// Canonical rename rules for the DeepSeek -> Greeneek rebrand (`dsh` -> `gnk`).
//
// ORDER MATTERS: the text pass applies these top to bottom, so glue forms and
// hosts must be matched before the generic brand tokens. This module is the
// single source of truth for the rebrand: never hand-apply a rename that is
// not derivable from these rules, so the codemod can be re-applied after an
// upstream merge (see scripts/rebrand/decisions.md, "Sync recipe").
//
// Token families were derived from a full-tree inventory (see decisions.md):
// every character adjacent to `dsh`/`deepseek` anywhere in the tracked tree
// was enumerated and classified. Notable false positives deliberately NOT
// matched: `handshake` (lowercase `dsh` inside, alnum on both sides),
// `headSha`/`loadShared`/`CardShell` (mixed-case `dSh` which no rule targets),
// and every long base64/hash run (word boundaries cannot fire inside them).

/** Ordered `[regex, replacement]` pairs applied line by line. */
export const RULES = [
  // ---------- npm scope and org collapse (drops the legacy `-ai` suffix) ----------
  // `@deepseek-ai/<pkg>` is the workspace scope; `github.com/deepseek-ai/...` is
  // the org path; `github.com/deepseek-harness/...` is the vendor-fork mirror org.
  { re: /@deepseek-ai\//g, to: '@greeneek/' },
  { re: /deepseek-ai\//g, to: 'greeneek/' },
  { re: /github\.com\/deepseek-harness\//g, to: 'github.com/greeneek/' },

  // ---------- generated docs anchors (GitHub slug of `@scope/name` headings) ----------
  // `@deepseek-ai/dsh-tool-todo` -> `deepseek-aidsh-tool-todo` (the `/` and `@` are
  // stripped by the slugger). After the scope collapse the new slug is
  // `greeneekgnk-tool-todo` with NO hyphen: match the glued form explicitly first.
  { re: /deepseek-aidsh/g, to: 'greeneekgnk' },
  // Any remaining bare `deepseek-ai` token (prose like "the `@deepseek-ai` scope",
  // regex sources like `@deepseek-ai\/dsh-x`): the org segment becomes `greeneek`.
  { re: /deepseek-ai(?![A-Za-z0-9])/g, to: 'greeneek' },

  // ---------- model/gateway endpoints (P8: sever DeepSeek, repoint to Greeneek) ----------
  // These are wire values, rewritten as data per decisions.md: the old provider
  // is severed, the new gateway owns its catalog ids (`greeneek-v4-flash`, ...).
  // Right-hand alnum guard: `deepseek.com` must not eat an identifier such as
  // `deepseek.component` (property access) — host matches end at a boundary.
  { re: /api\.deepseek\.com(?![A-Za-z0-9])/g, to: 'api.greeneek.dev' },
  { re: /api-docs\.deepseek\.com(?![A-Za-z0-9])/g, to: 'api-docs.greeneek.dev' },
  { re: /docs\.deepseek\.com(?![A-Za-z0-9])/g, to: 'docs.greeneek.dev' },
  { re: /platform\.deepseek\.com(?![A-Za-z0-9])/g, to: 'platform.greeneek.dev' },
  { re: /chat\.deepseek\.com(?![A-Za-z0-9])/g, to: 'chat.greeneek.dev' },
  { re: /www\.deepseek\.com(?![A-Za-z0-9])/g, to: 'www.greeneek.dev' },
  { re: /deepseek\.com(?![A-Za-z0-9])/g, to: 'greeneek.dev' },
  // Test-only reserved TLD fixture hosts (api.deepseek.test -> api.greeneek.test).
  { re: /deepseek\.test(?![A-Za-z0-9])/g, to: 'greeneek.test' },
  // The DeepSeek token-plan/search web host family on other TLDs, if referenced.
  { re: /deepseek\.cn(?![A-Za-z0-9])/g, to: 'greeneek.dev' },

  // ---------- tokens glued to escape sequences (`'\\0dsh-css:'`, `'\\nDSH_STALE'`) ----------
  // The escape's final character (`0`, `n`, `r`, `t`, `7`) is alphanumeric, so the
  // boundary rules cannot fire; the seams below teach the engine the exact context.
  { re: /(?<=\\0)DSH_(?=[A-Z])/g, to: 'GNK_' },
  { re: /(?<=\\n)DSH_(?=[A-Z])/g, to: 'GNK_' },
  { re: /(?<=\\0)dsh(?![A-Za-z0-9])/g, to: 'gnk' },
  { re: /(?<=\\n)dsh(?![A-Za-z0-9])/g, to: 'gnk' },

  // ---------- terminal prompt glued to an ANSI escape (`\x07dsh> `) ----------
  // The preceding `7` is alphanumeric, so the boundary rules below cannot fire.
  { re: /(?<=x07)dsh(?![A-Za-z0-9])/g, to: 'gnk' },

  // ---------- long brand tokens (no boundary needed: "deepseek" has no English use) ----------
  { re: /DEEP\s?SEEK/g, to: 'GREENEEK' },
  { re: /Deep\s?Seek/g, to: 'Greeneek' },
  { re: /Deepseek/g, to: 'Greeneek' },
  { re: /deepSeek/g, to: 'greeneek' },
  { re: /DeepSeek/g, to: 'Greeneek' },
  { re: /deepseek/g, to: 'greeneek' },

  // ---------- short token: `dsh` family (word-boundary enforced) ----------
  // ALL-CAPS prefixed PascalCase identifiers: DSHInspector -> GNKInspector.
  { re: /(?<![A-Za-z0-9])DSH(?=[A-Z][a-z])/g, to: 'GNK' },
  // Env vars / constant names / standalone: DSH_HOME, $DSH_, 'DSH', .DSH., DSH
  // (underscore is a boundary character here so `X_DSH_VAR` and `dsh_home` match).
  { re: /(?<![A-Za-z0-9])DSH(?![A-Za-z0-9])/g, to: 'GNK' },
  // PascalCase at word start: DshWindow, DshEnvironmentKey, DshHome.
  { re: /(?<![A-Za-z0-9])Dsh(?![a-z0-9])/g, to: 'Gnk' },
  // PascalCase at word start followed by more caps-word: DshFoo.
  { re: /(?<![A-Za-z0-9])Dsh(?=[A-Z])/g, to: 'Gnk' },
  // camelCase interior: parseDshArgs, resolveDshHome, checkedDshEdges.
  { re: /(?<=[a-z0-9])Dsh(?=[A-Z])/g, to: 'Gnk' },
  // lowercase standalone/hyphen/dot/underscore runs: dsh, dsh-cli, .dsh/, dsh_home.
  { re: /(?<![A-Za-z0-9])dsh(?![A-Za-z0-9])/g, to: 'gnk' },
  // lowercase followed by camel tail: dshHome, dshEnv, @dshScopeScan.
  { re: /(?<![A-Za-z0-9])dsh(?=[A-Z])/g, to: 'gnk' },
];

/**
 * Path fragments (posix, matched as substrings on the whole repo-relative
 * path) that the text pass never touches, and that `git mv` skips.
 */
export const DENY_PATH_SUBSTRINGS = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'coverage/',
  // CRITICAL: the codemod must never touch its own sources. A text pass that
  // rewrites the rule file mid-run silently corrupts every later pass (learned
  // the hard way during development of this very file).
  'scripts/rebrand/',
  '.rebrand/',
  'docs/migration-from-deepseek.md',
  'patches/', // pnpm patch files: hashed by pnpm, must stay byte-exact
  'vendor/cordis/LICENSE',
  'vendor/cosmokit/LICENSE',
  'vendor/group/LICENSE',
  'vendor/hmr/LICENSE',
  'vendor/include/LICENSE',
  'vendor/loader/LICENSE',
  'vendor/logger-console/LICENSE',
  'vendor/schemastery/LICENSE',
  'vendor/timer/LICENSE',
  'native/landlock-run/LICENSE',
];

/** Filename (basename) denials for the text pass. */
export const DENY_BASENAMES = [
  'LICENSE',
  'pnpm-lock.yaml',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
];

/** Extensions the text pass accepts; everything else is skipped (binaries, png...). */
export const ALLOW_EXTENSIONS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'mjs', 'cjs', 'json', 'jsonl', 'jsonc',
  'md', 'markdown', 'yaml', 'yml', 'toml', 'css', 'scss', 'html', 'htm',
  'txt', 'svg', 'snap', 'sh', 'bash', 'zsh', 'ps1', 'py', 'rs', 'cpp', 'hpp',
  'c', 'h', 'ipc', 'sql', 'xml', 'webmanifest', 'conf', 'cfg', 'ini', 'properties',
]);

/** Files with NO extension that are still text (checked against basename). */
export const ALLOW_NOEXT_NAMES = new Set([
  '.npmrc', '.nvmrc', '.node-version', '.dockerignore', '.gitmodules',
  'Dockerfile', 'Makefile', 'NOTICE',
]);

/**
 * Exact repo-relative paths that MUST be processed even though their name or
 * location is denied — the brand tokens in them are live contracts:
 *  - `.gitignore` ignores generated paths that move with the brand.
 *  - `python/sdk/uv.lock` names the two editable workspace packages (no wheel
 *    integrity involved; third-party entries are untouched by the rules).
 *  - the node-pty patch's single `+` line carries the `DSH_NODE_PTY_SPAWN_HELPER`
 *    env name (content line only; context stays byte-exact so pnpm still applies).
 */
export const FORCE_TEXT_FILES = new Set([
  '.gitattributes',
  '.gitignore',
  'python/sdk/uv.lock',
  'patches/node-pty@1.2.0-beta.15.patch',
  'packages/experimental/webworker-runtime/tests/node/shim-diff.spec.ts',
]);

/**
 * Lines skipped even inside allowed files. The copyright rule is a legal
 * constraint (MIT attribution for the upstream work must survive verbatim),
 * `rebrand:keep` is the manual per-line escape hatch.
 */
export const PROTECTED_LINE = [
  /"dsh":\s*"lib\/bin-legacy\.js"/, // legacy bin alias is the deprecation contract itself (D2)
  /Copyright\s*(\(c\)\s*)?2026\s+DeepSeek/i,
  /Copyright\s*(\(c\)\s*)?\d{4}.{0,60}DeepSeek/i,
  /SPDX-License-Identifier/i,
  /rebrand:keep/,
];

/** Block escape hatch: lines between start and end markers are untouched. */
export const BLOCK_START = /rebrand:ignore-start/;
export const BLOCK_END = /rebrand:ignore-end/;

/**
 * Files that may legitimately contain residual `deepseek`/`dsh` after the
 * rebrand, each with a reason (enforced by verify-residue.mjs).
 */
export const RESIDUE_ALLOWLIST = [
  { file: /^(\.\/)?apps\/cli\/package\.json$/, why: 'D2: the "dsh" bin alias line is the deprecation contract itself; re-runs cannot see a marker inside JSON, and PROTECTED_LINE already pins it' },
  { file: /^(\.\/)?LICENSE$/, why: 'retained upstream copyright attribution' },
  { file: /^(\.\/)?THIRD_PARTY_NOTICES\.md$/, why: 'upstream fork provenance table (deepseek-harness org ids)' },
  { file: /^(\.\/)?docs\/migration-from-deepseek\.(zh\.)?md$/, why: 'intentional migration guide (both locales)' },
  { file: /^(\.\/)?scripts\/rebrand\//, why: 'the codemod itself' },
  { file: /^(\.\/)?\.rebrand\//, why: 'baseline snapshots taken pre-rebrand' },
  { file: /^(\.\/)?pnpm-lock\.yaml$/, why: 'regenerated by pnpm install, never hand-edited' },
  { file: /^(\.\/)?snapshots\/acp\/handshake(\/|$)/, why: 'false positive: "handshake" contains dsh' },
  { file: /^(\.\/)?packages\/util\/egress\//, why: 'P8: the guard is the home of the blocklist — the host regexes, its specs, and the README description must name the retired hosts it refuses (decisions.md D7)' },
  { file: /^(\.\/)?scripts\/brand-sweep\.sh$/, why: 'the gate quotes the tokens it forbids' },
  { file: /^(\.\/)?packages\/llm\/llm-pi-ai\//, why: 'B4: pi-ai upstream catalog provider ids and thinkingFormat wire values — typed contract of @earendil-works/pi-ai; DeepSeek endpoints stay refused by the egress guard in buildProvider (decisions.md D16)' },
  { file: /^(\.\/)?apps\/web\/tests\/expected\/models-settings\/empty\.expected\.md$/, why: 'D16: aria snapshot of the pi-ai upstream provider catalog — deepseek is a catalog id like cerebras/fireworks, not a brand claim' },
];

/**
 * Parity ledger: every non-mapping surface diff that has been triaged as
 * intentional (feature ADDITIVE or asset replacement). `parity-check.mjs`
 * still hard-fails on anything unlisted — and on every *missing* baseline
 * line, which would mean feature loss.
 *   artifact: which capture file; pattern: matched against the diff line;
 *   direction: which side of the diff it excuses.
 */
export const EXPECTED_DIFFS = [
  // The rebrand rig and the compat layer it adds (P0-P8): tracked after the
  // baseline was taken, so they read as additions against baseline+map.
  { artifact: 'files.txt', direction: 'added', pattern: /^scripts\/rebrand\//, why: 'the codemod, verifier, generators, and decision register (plan §5)' },
  { artifact: 'files.txt', direction: 'added', pattern: /^scripts\/brand-sweep\.sh$/, why: 'P9 build-time brand gate wired into ci.yml (quotes forbidden tokens; allowlisted for residue)' },
  { artifact: 'files.txt', direction: 'added', pattern: /^apps\/cli\/src\/bin-legacy\.ts$/, why: 'D2 legacy bin alias' },
  { artifact: 'files.txt', direction: 'added', pattern: /^docs\/migration-from-deepseek\.(zh\.md|md|i18n\.yaml)$/, why: 'P6 migration guide, its mandated zh counterpart, and the pairing record' },
  { artifact: 'files.txt', direction: 'added', pattern: /^packages\/util\/egress\//, why: 'P8 egress guard package (policy + specs + README pair)' },
  { artifact: 'files.txt', direction: 'added', pattern: /tests\/(legacy-compat|legacy-alias|persisted-key-legacy\.client|scrub-legacy)\.spec\.ts$/, why: 'P4 compat-shim specs (D2/D4/D5/D14)' },
  // Manifest edits: legacy bin alias (D2), egress dependency wiring (P8),
  // rebrand scripts (P0), and the new guard package itself.
  { artifact: 'packages.json', direction: 'missing', pattern: /^\{"file":"(?:package\.json|apps\/cli\/package\.json|packages\/llm\/llm-greeneek\/package\.json|packages\/llm\/llm-pi-ai\/package\.json|packages\/web\/web-search-greeneek\/package\.json)"/, why: 'entries re-appear in modified form (ledger lists them under added)' },
  { artifact: 'packages.json', direction: 'added', pattern: /^\{"file":"(?:package\.json|apps\/cli\/package\.json|packages\/llm\/llm-greeneek\/package\.json|packages\/llm\/llm-pi-ai\/package\.json|packages\/web\/web-search-greeneek\/package\.json)"/, why: 'bin alias + @greeneek/gnk-egress dependency + rebrand scripts' },
  { artifact: 'packages.json', direction: 'added', pattern: /^\{"file":"packages\/util\/egress\/package\.json"/, why: 'new guard package (P8)' },
  // P5 asset replacement: the whale artwork (the only xlink consumer) is gone.
  { artifact: 'files.txt', direction: 'added', pattern: /^packages\/util\/egress\/(README|package)/, why: 'P8 guard package README pair + manifest' },
  { artifact: 'files.txt', direction: 'added', pattern: /^website\/public\/(wordmark|favicon)\.svg$/, why: 'P5 wordmark/favicon rewrites (asset replacement)' },
  { artifact: 'files.txt', direction: 'added', pattern: /^apps\/web\/public\/(assets\/logo-mark\.png|favicon\.png|favicon\.svg)$/, why: 'P5 brand asset regeneration' },
  { artifact: 'files.txt', direction: 'added', pattern: /^packages\/skill\/skill-badge\/(assets\/gnk-badge\.png|tests\/skill-badge\.spec\.ts)$/, why: 'P5 badge regeneration + integrity pin update (D17)' },
  { artifact: 'files.txt', direction: 'added', pattern: /\.rebrand\/(after|baseline)\//, why: 'the parity rig\'s own snapshots (self-referential by construction)' },
  { artifact: 'files.txt', direction: 'added', pattern: /^packages\/llm\/llm-pi-ai\/tests\/adapter\.e2e\.ts$/, why: 'cross-adapter structural e2e, gated on live gateway credentials' },
  { artifact: 'urls.txt', direction: 'added', pattern: /^https?:\/\/([A-Za-z0-9.-]*\.)?greeneek\.(dev|com|ai)(\/|$)/i, why: 'green-field gateway-family fixtures in the new egress package specs (allow/strict passes)' },
  { artifact: 'urls.txt', direction: 'missing', pattern: /^http:\/\/www\.w3\.org\/1999\/xlink$/, why: 'P5: only the replaced whale favicon used the xlink namespace' },
  { artifact: 'urls.txt', direction: 'added', pattern: /^(https?:)?\/\/([A-Za-z0-9.-]*\.)?deepseek\.(com|ai|cn)(\/|$)/i, why: 'the blocklist itself: egress specs/README name the retired hosts to prove they are refused (D7)' },
  { artifact: 'urls.txt', direction: 'added', pattern: /^https?:\/\/example\.(org|com)(\/|$)/, why: 'egress spec fixtures for allow/strict-mode passes' },
  { artifact: 'urls.txt', direction: 'added', pattern: /^https:\/\/api\.greeneek\.dev(\/|$)/, why: 'the new gateway host itself: strict-mode allow-list fixtures and README examples (D7 makes it the only sanctioned endpoint)' },
]
/** Apply every rule to a string (used for paths, basenames, and parity projections). */
export function mapText(s) {
  let out = s;
  for (const { re, to } of RULES) out = out.replace(re, to);
  return out;
}

export function isDeniedPath(relPath) {
  return DENY_PATH_SUBSTRINGS.some((frag) => relPath.includes(frag));
}

export function isTextCandidate(relPath) {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  if (DENY_BASENAMES.includes(base)) return false;
  const dot = base.lastIndexOf('.');
  if (dot === -1) return ALLOW_NOEXT_NAMES.has(base);
  const ext = base.slice(dot + 1).toLowerCase();
  return ALLOW_EXTENSIONS.has(ext);
}
