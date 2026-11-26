# Agent Note: OpenCode Fleet e2e on a free route

Status: implemented

## Problem

`opencode-acp-fleet.e2e.ts` pinned `groq/openai/gpt-oss-20b`. On a free-tier Groq account the assembled prompt exceeds the 8000 TPM allowance (`Requested 22832`), so the external ACP member settled with a transport-stage error instead of a real answer. The failure was a provider quota refusal, not a Greeneek defect.

## Decision

The suite now pins `opencode/hy4-flash-free`, a free model with no model key that accepts the assembled prompt. This keeps the test exercising the real OpenCode subprocess, ACP transport, Team membership, and mailbox reporting while staying inside free-tier limits. No OpenCode authentication configuration was modified.

## Alternatives considered

Reducing the assembled prompt to fit Groq's quota would weaken the real-composition coverage. Keeping the Groq route would leave the suite permanently red on free-tier accounts.

## Testing

`pnpm exec vitest run --config vitest.e2e.config.ts packages/subagent/agent-team/tests/opencode-acp-fleet.e2e.ts` — 1 file, 3 tests passed on Windows. Direct `opencode run --model opencode/hy4-flash-free 'Reply with exactly: PROBE OK'` also succeeded before the suite run.

## Consequences

The OpenCode Fleet integration is exercised end to end on free resources; provider quota exhaustion no longer masks the ACP lifecycle being tested.
