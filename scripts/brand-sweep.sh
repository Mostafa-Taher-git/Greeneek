#!/usr/bin/env bash
# CI brand gate. The rebrand contract is three-sided and machine-checked here:
#
#   1. residue      — no DeepSeek/dsh identity may re-enter the tree outside the
#                     explicit allowlists (attribution, migration docs, the
#                     codemod itself, known false positives like `handshake`).
#   2. egress       — no shipped source or config may reference a retired
#                     DeepSeek endpoint; the only sanctioned occurrence family is
#                     the egress blocklist in packages/util/egress.
#   3. attribution  — the upstream MIT copyright notice stays in LICENSE and
#                     README, and the notices file keeps the upstream-harness
#                     disclosure (scripts/rebrand/verify-attribution.mjs).
#
# Verifiers are dependency-free Node scripts; allowlists live in
# scripts/rebrand/mapping.mjs, decisions live in scripts/rebrand/decisions.md.
# Re-run after any upstream merge: see the "Sync recipe" in decisions.md.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/rebrand/verify-attribution.mjs
node scripts/rebrand/verify-residue.mjs
node scripts/rebrand/verify-egress.mjs
