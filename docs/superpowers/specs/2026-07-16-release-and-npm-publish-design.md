# Production-ready release & npm publishing — design

**Date:** 2026-07-16
**Status:** Approved

## Goal

Make `zerowatch` publishable to npm through GitHub Actions in a way that is
secure, reproducible, and trustworthy (supply-chain provenance), while keeping
the author in control of *when* a release ships.

The code itself is already hardened (recent production-hardening pass, CI matrix
across Linux/macOS/Windows, dual ESM/CJS build, `attw` type checks). This work
is about the release/publish infrastructure and package metadata.

## Decisions

- **Trigger model:** tag-triggered CI publish. `release-it` runs locally to cut
  the release (version bump, CHANGELOG, commit, annotated `vX.Y.Z` tag, GitHub
  release). Pushing the tag fires a `release.yml` workflow that publishes to npm.
- **Provenance:** enabled via `publishConfig.provenance` + GitHub OIDC
  (`id-token: write`). A plain `npm publish` in CI emits the attestation.
- **Auth:** `NPM_TOKEN` (npm Automation token) stored as a GitHub Actions repo
  secret, consumed as `NODE_AUTH_TOKEN`. The token never lives on a laptop.

## Changes

### 1. `package.json` metadata
Add `author`, `repository`, `bugs`, `homepage`, and
`publishConfig: { access: "public", provenance: true }`.

### 2. `.release-it.json`
Set `npm.publish` to `false` — publishing moves to CI so OIDC provenance is
possible. `release-it` retains git + GitHub-release duties.

### 3. `.github/workflows/release.yml`
- Trigger: push of tag `v*`.
- Permissions: `contents: read`, `id-token: write`.
- Steps: checkout → setup-node (registry-url `https://registry.npmjs.org`) →
  `yarn install --frozen-lockfile` → `yarn typecheck` → `yarn test` →
  `yarn build` → `yarn attw` → assert git tag == `package.json` version →
  `npm publish` (`NODE_AUTH_TOKEN` = `secrets.NPM_TOKEN`).

### 4. README badges
CI status, npm version, node version.

## First-publish flow

The package name `zerowatch` is unclaimed on npm (verified 404). The first
publish uses `NPM_TOKEN`. Once v0.1.0 exists, the project *may* migrate to npm
**Trusted Publishing** (OIDC-only, no long-lived token) — deferred, not done
here.

## Out of scope

Dependabot, CodeQL, Trusted-Publishing migration, `marketing_plan_todo.md`
cleanup.

## Release flow (end to end)

```
yarn release  →  bump + CHANGELOG + commit + tag v0.1.0 + GitHub release  →  push
                                                                              ↓
                                            release.yml (on tag) → build/test → npm publish (+provenance)
```
