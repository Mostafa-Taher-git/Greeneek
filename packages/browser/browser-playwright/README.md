# @greeneek/gnk-browser-playwright

Real browser content provider for the browser-use seam. It launches a local
Chromium through Playwright, keeps one persistent context per browser profile,
and exposes bounded page reading and link following to the Agent.

- The `default` profile uses a durable directory under `userDataRoot`, so a
  manually established session survives across reads and host restarts.
- The `incognito` profile uses a fresh temporary directory removed on close.
- Profiles are isolated by storage directory: no provider can read another's
  cookies or local storage. No password is collected and no cookie is extracted
  into Greeneek state.
- Page text is bounded and returned as untrusted data. No CAPTCHA, MFA, or
  anti-bot bypass is attempted.

## Model Experience

This provider introduces no tools or model-visible text of its own. It supplies
the content capability that the browser tools use.

## Known Limitations and Deferred Work

- Requires a local browser binary (Playwright-managed Chromium or a compatible
  install).
- Driving JS-heavy SSO/login flows is a user action (Manual Mode), not an
  automated capability.
