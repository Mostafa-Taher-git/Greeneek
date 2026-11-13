---
description: "Obsidian-style session-search query language: tokenization, recursive-descent parsing, SQLite FTS5 compilation, and visible-field evaluation for the sidebar search box"
kind: "package-library"
---

# gnk-search-query


## Summary

`gnk-search-query` is the shared parser for Greeneek's sidebar session search. It implements an Obsidian (Notes)-style global-search grammar: a query is a boolean expression over content and metadata leaves, compiled to exactly one target per leg.

- Bare words and `"quoted phrases"` are content leaves (FTS5 match over message text).
- `content:<value>` is the explicit content operator.
- `path:<value>` filters the session working directory, `file:<value>` its basename, `title:<value>` the session title.
- A leading `-` negates any operand, including groups: `-path:foo`, `-(a or b)`.
- `or` disjoins operands (case-insensitive); juxtaposition conjoins them; parentheses group.

## API

```ts
import { parseSearchQuery, compileContentFts5, evaluateSearchQuery } from '@greeneek/gnk-search-query'
```

| Export | Shape | Purpose |
|---|---|---|
| `parseSearchQuery(input)` | `(string) => SearchQueryNode` | Tokenizer + recursive-descent parser; throws `SearchQueryError` on every malformation (never silently weakens the query) |
| `compileContentFts5(node)` | `(SearchQueryNode) => string \| null` | The **content leg** for SQLite FTS5: keep clauses join as `AND`, exclusions append as infix `<expr> NOT <expr>`. Returns `null` when nothing constrains content (pure exclusions, path/title-only queries) |
| `evaluateSearchQuery(node, doc, options?)` | `(SearchQueryNode, SearchHaystack, EvaluateSearchOptions?) => boolean` | The **visible-field leg** for sidebar rows: `enforce` checks the visible haystack (local rows), `host-authoritative` trusts the host FTS leg (remote rows); visible leaves (path/file/title) are checked directly; exclusions veto only against visible-field needles |
| `hasContentTerms / hasPathTerms / hasFileTerms / hasTitleTerms` | `(SearchQueryNode) => boolean` | Leg detection for routing and gating |
| `collectLeaves / collectContentLeaves` | `(SearchQueryNode) => readonly SearchQueryLeaf[]` | Diagnostics and explanations |
| `SearchQueryError` | `class · extends Error` | `code` is machine-checkable: `QUERY_TOO_LONG EMPTY_QUERY INVALID_OPERAND UNTERMINATED_QUOTE UNMATCHED_PAREN EMPTY_PARENS UNKNOWN_OPERATOR MISSING_OPERATOR_VALUE INVALID_OPERATOR` |

## Two legs of one grammar

The grammar splits the query by what the corpus can answer truthfully:

- **Content truth lives at the host.** Messages are indexed in FTS5; the host compiles only content leaves into the MATCH expression. Pure-exclusion content expressions have no FTS5 representation (`NOT` cannot match "all rows except"), so they return `null` — the content leg is unconstrained and the host returns no FTS rows; title/path answers still flow through the client leg.
- **Visible truth lives at the client.** Titles are not indexed at the host; paths are local metadata the client already merge-sorts. `path:`, `file:`, `title:` evaluate locally against the visible row fields (title, working directory, snippet). A phrase leaf is candidate-true at the host; under `'enforce'` it is checked against the visible haystack (the client's only evidence), under `'host-authoritative'` it passes on the host's word alone (its snippet may not contain every term).
- **`-` spans both legs.** Content exclusions ride infix `NOT` at the host; the client applies the same negation over the visible haystack, so title/path rows are excluded exactly when the negated visible fields match.

The exact FTS5 round-trip is pinned against the runtime SQLite build (3.54.0): `AND`, `OR`, parenthesized groups, and left-associative infix `NOT` chain (`a NOT b NOT c`); unary `NOT`, `AND NOT` are supported by neither the documented grammar nor this build.

## Table of Contents

- [How the sidebar search behaves](#how-the-sidebar-search-behaves)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="how-the-sidebar-search-behaves"></a>
## How the sidebar search behaves

- Empty field: the syntax hint and up to five recent queries (`gnk.search-query.recent-queries`) are shown; clicking a recent restores it.
- A parse error suppresses the host round-trip and shows the syntax-error line, not an empty result area.
- Plain words keep the pre-existing behavior: the title or the working directory matching the word.
- Ordering: local (title/path/label) matches lead, host content matches follow, deduplicated — unchanged.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Regex (`/foo/`) is out of scope: the FTS corpus cannot express it and v1 does not execute it client-side.
- Nested negation inside an `or` group contributes nothing to FTS (`a or -b` keeps the `a` leg); the client's `evaluateSearchQuery` evaluates the full expression regardless.
- `line:`, `block:`, `section:`, `task:`, `tag:` are intentionally absent: Greeneek sessions carry no line blocks, tasks, or tags.
- A `title:`-only or `path:`-only query matches **only locally** (the host content leg is `null` by design and the host returns no content rows for it).
- Content exclusions ride infix `NOT` at the host — SQLite's FTS5 has no match-all-except operator, so pure-exclusion queries cannot constrain the content index at all and surface zero content rows by design.
- `title:` gates the client rows only; the merged host content rows whose title fails a positive `title:` predicate are silently hidden — that is the documented semantics, not a dropped result.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

The compiled expression, not the request text, is the FTS contract: `requestFingerprint` hashes the raw query, but identical queries parse identically, so cursor consistency holds. Path/file predicates run on the client and on the host's visible-session set only — the derived index carries `cwd` but the package deliberately keeps one truth (the client leg) for local rows instead of two. The exe/installer story for the workspace-path pack is untouched; this package is not a plugin and registers nothing.

</details>

**Runtime invariant:** No companion is published. This utility owns no mutable runtime relationship.
