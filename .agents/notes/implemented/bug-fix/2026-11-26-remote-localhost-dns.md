# Agent Note: remote welcome test on Windows

Status: implemented

## Problem

`apps/web/tests/remote-welcome.e2e.ts` could not start on Windows: `launchWebScaffold` fetched `http://remote.localhost:<port>` through Node's fetch, and Windows has no wildcard `*.localhost` DNS, producing `getaddrinfo ENOTFOUND remote.localhost` before the test body ran. Chromium had the same resolution gap.

## Decision

The test keeps the synthetic non-loopback authority in the URL and Host header, which is the trusted-host behavior under test. Chromium receives a `--host-resolver-rules=MAP remote.localhost 127.0.0.1` launch argument. Node's `dns.lookup` is wrapped for the duration of the suite so only that hostname resolves to loopback, and the original function is restored in `afterAll`. The CommonJS binding is used because an ESM namespace property is read-only.

## Alternatives considered

Replacing the authority with plain `localhost` would stop exercising the trusted-host boundary. Adding a system hosts entry would require elevated machine changes and would not travel with the test.

## Testing

Windows before the fix: `1 failed`, `getaddrinfo ENOTFOUND remote.localhost`. After the fix: `1 file / 1 test passed` on Windows and the same file passes on Linux with `GNK_SNAPSHOT=replay`. Commands: `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/remote-welcome.e2e.ts`. No golden files were changed and no assertion was weakened.

## Consequences

The remote-host welcome flow is now exercised on both platforms without changing product code or the committed Linux goldens.
