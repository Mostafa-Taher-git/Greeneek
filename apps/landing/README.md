# Greeneek landing site

Public marketing site for Greeneek, live at <https://greeneek.vercel.app/>:
product overview, quick start, desktop downloads, and FAQ. English-only
single-page Vite + React + Tailwind app that builds to one self-contained
`dist/index.html`.

## Develop

```sh
pnpm --filter @greeneek/landing run dev
```

## Build

```sh
pnpm --filter @greeneek/landing run build
```

## Deploy on Vercel

New Project → Import Git Repository → `Greeneek`, with these settings:

```text
Root Directory: apps/landing
Framework: Vite
Build Command: npm run build
Output Directory: dist
```

Every push to the production branch redeploys automatically; branches and PRs
get preview deployments. `vercel.json` routes the deployment decision through
`vercel-ignore.mjs`: a push that touches no landing file and no root workspace
or dependency input skips the build, while a missing previous SHA or git
failure always builds. The project Root Directory must stay `apps/landing`,
which the helper's repo-relative path matching assumes.

## Download links

All download buttons point at the GitHub Releases page, which carries the
per-platform desktop artifacts built by the `desktop` release workflows. No
binaries live in this repository.
