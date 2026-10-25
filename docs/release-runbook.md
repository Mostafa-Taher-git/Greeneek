# Release runbook

One page, three release families. Each family moves its own version, has its own tag format, and is published by one script or workflow that decides per package against the target.

## npm families (`v*` registry publication)

The `@greeneek/gnk` runtime packages, the rescoped `vendor/` Cordis packages, and the `native/` packages each have a bump step and one publication ([sequences](../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)):

```sh
pnpm run release:gnk        # bump one family's version
pnpm run release:verify     # validate manifests and the release order
pnpm run release:pack       # build and stage versioned tarballs
pnpm run release:verify-packed-install
pnpm run release:publish    # publish per package against the registry
```

Publication is decided per package: a version the registry lacks is published, an identical tarball is skipped, and a differing tarball at the same version fails the run. Re-running the publish step over the same staged artifacts is safe.

## Desktop (`desktop-*` tags)

Pushing a `desktop-v<semver>` tag runs `.github/workflows/release-desktop.yml`, which builds both platforms and publishes once:

1. `gate` refuses the release unless the tagged commit carries a `ci` workflow result and every check run on it is completed without a failure, waiting up to 30 minutes for queued runs. A commit with no check run at all is rejected rather than treated as green, so a tag pushed without its commit on `main` cannot ship.
2. `linux` and `windows` run in parallel from that commit, build the host libraries and web app, stamp the desktop version from the tag with `apps/desktop/scripts/stamp-version.mjs`, and run `electron-builder` with `--publish never`. Each job asserts its updater channel files — Linux: `latest*.yml` + `AppImage` + `*.zsync` (AppImage targets emit no blockmap; zsync is built in CI with zsyncmake so deltas keep working); Windows: `latest*.yml` + `*.blockmap` for the NSIS installer — and uploads artifacts instead of publishing.
3. `scripts/prepare-release-assets.mjs` copies versioned artifacts to stable `Greeneek-Desktop-latest-*` aliases for human links; the updater never reads the aliases, only the versioned filenames referenced inside `latest*.yml`.
4. `publish` needs both build jobs, refuses a partial set, and attaches everything to the tag's GitHub Release in one `softprops/action-gh-release` step with `fail_on_unmatched_files`. `concurrency: release-<ref>` keeps two tag pushes from interleaving, and only this job holds `contents: write`.

Manual dispatch takes an existing tag name, so a release can be rebuilt without moving the tag. Never move or delete a `desktop-*` tag: its commit is what users installed.

Published artifacts today: Linux `deb` + `AppImage`, Windows NSIS `exe` + portable `zip`. All are unsigned; the download links in `docs/user/guide/desktop.md` point at `releases/latest/download/<alias>` and stay stable across versions. Adding code signing or notarization means adding a signing job whose success gates the publish job, plus regenerating the Windows blockmap and `latest.yml` after signing so delta updates keep working.

## Website (`docs/user` projection)

`docs/user/` prose and the desktop download links are the canonical sources; `pnpm run website:build` validates links and `pnpm run doc-sync` gates the documentation. Update the desktop guide's download links only when an artifact type joins or leaves the release set.
