# AGENTS.md — GitHub Actions

This fork carries two workflows, and they are the whole check surface until
another is added here.

`ci.yml` runs on every push to `main`/`master` and every pull request against
them, on one Ubuntu runner with Node 22: `pnpm lint`, `pnpm typecheck`,
`pnpm test -- --coverage --reporter=verbose`, `pnpm build`, a gitleaks secret
scan over the push range, a non-blocking `pnpm audit --audit-level=high`, and the
brand sweep. Its job id is `ci`, which is what the release gate looks for.

`release-desktop.yml` builds both desktop platforms on a `desktop-*` tag or a
manual dispatch that names one, then publishes a single GitHub Release. Its
`gate` job fails closed unless that commit carries a `ci` result and every check
run on it completed without a failure, so a red suite on the tagged commit
cannot ship installers. Only the `publish` job holds `contents: write`.

Older process notes in this repository describe a master-only `ci-master.yml`,
a Wine-based pull-request Windows job, self-hosted failover pools, and runner
benchmarks. None of those jobs exists here; a check panel that shows only these
two workflows is telling the truth. Do not cite a run from that retired matrix as
evidence for this fork, and do not name a job in documentation before the
workflow that defines it exists.

Run Windows steps under native `pwsh`, never Bash. A `desktop-*` tag is the only
publish trigger for installers, and an existing tag is never moved or deleted:
its commit is what users installed. Read `.github/workflows/` before citing a
job, and `docs/release-runbook.md` before cutting a tag.
