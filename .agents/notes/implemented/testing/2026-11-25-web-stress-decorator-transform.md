# Agent Note: Web stress lane decorator transform

Status: implemented

## Problem

`apps/web/stress-tests/reasoning-chunks.stress.ts` failed before any test ran with `SyntaxError: Invalid or unexpected token` under `vitest.web-stress.config.ts`. The file itself parses cleanly; the failure came from standard TypeScript decorators in its source-imported Web modules, which Vite's default parser could not transform.

## Decision

The stress config now applies `standardDecoratorPlugin()` from `vitest.shared.ts`, the same pre-transform the Web e2e lane uses, ahead of `tsconfigPaths`. No test or product code changed.

## Alternatives considered

Rewriting decorated sources in the stress-imported graph would change production code to work around a test lane. Disabling the stress lane would hide the regression it is meant to measure.

## Testing

With the plugin, the stress file transforms and executes its test (the Windows browser-rendering timeout that follows is tracked separately under #141). The transform error is gone.

## Consequences

The opt-in performance lane can reach its assertions instead of failing at collection; its remaining platform behavior is covered by the Windows lane work.
