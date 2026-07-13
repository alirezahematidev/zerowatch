# Contributing to watchx

Thanks for your interest in improving watchx! This guide covers the workflow,
project layout, and conventions.

## Prerequisites

- **Node.js ≥ 20** (the project targets Node 20+ and uses only the standard
  library at runtime).
- **Yarn** (classic, v1) — the repo ships a `yarn.lock`.

```sh
git clone <your-fork>
cd watchx
yarn install
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `yarn build` | Bundle ESM + CJS + types into `dist/` (via [tsup](https://tsup.egoist.dev)). |
| `yarn dev` | Rebuild on change. |
| `yarn typecheck` | `tsc --noEmit` against the whole project. |
| `yarn test` | Run the Vitest suite once. |
| `yarn test:watch` | Run tests in watch mode. |
| `yarn test:coverage` | Run tests with a V8 coverage report. |
| `yarn bench` | Build, then run the startup/throughput benchmark (vs chokidar if installed). |
| `yarn clean` | Remove `dist/`. |

Before opening a PR, make sure **`yarn typecheck && yarn test`** both pass.

## Project layout

```
src/
  api.ts              # public watch()/createWatcher() surface
  core/               # Watcher orchestration, classifier, async queue, options
  events/             # typed emitter, event factory, move detector
  ignore/             # ignore engine, glob compiler, .gitignore parser
  platform/           # fs.watch adapters + polling backend (the OS seam)
  scanner/            # tree walk + write-stability
  types/              # public and internal type definitions
  utils/              # path helpers
test/                 # Vitest specs (unit + integration)
bench/                # startup/throughput benchmark
```

The **platform layer** is the only place that touches `fs.watch`. The core never
references a concrete adapter — it goes through `createPlatformWatcher`. Keep new
OS-specific behavior behind that seam.

## Coding conventions

- **Strict TypeScript.** No `any`, no `@ts-ignore`; `strict` and
  `exactOptionalPropertyTypes` are on. Prefer precise types over casts.
- **ESM import specifiers** must include the `.js` extension (NodeNext).
- **No new runtime dependencies.** watchx is zero-dependency by design; dev-only
  tooling is fine.
- **Errors never crash.** Recoverable errors surface via the `error` event; the
  watcher keeps running. Don't throw from the event hot path.
- Match the surrounding style: focused classes, doc comments on public methods,
  and comments that explain *why*, not *what*.

## Tests

- Add or update tests for any behavior change. Unit tests live alongside the
  logic they cover; integration tests drive a real `watch()` over a temp dir.
- FS-watching tests are timing-sensitive. Use the helpers in
  [`test/helpers.ts`](test/helpers.ts) (`waitFor`, `sleep`, `tempDir`, `collect`)
  and allow generous timeouts. Native watchers (macOS/Windows) can need a brief
  warm-up before delivering events on a freshly-attached path.
- Prefer deterministic unit tests with fake timers (`vi.useFakeTimers()`) for
  pipeline components (debouncer, batcher, move detector).

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) so the
changelog and version bumps can be generated automatically:

```
feat: add polling backend
fix: suppress ignored subtrees on macOS
perf: skip path normalization on POSIX
docs: clarify awaitWrite semantics
```

Common types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
`chore`. A `!` after the type (or a `BREAKING CHANGE:` footer) marks a breaking
change.

## Releasing (maintainers)

Releases are cut with [release-it](https://github.com/release-it/release-it):

```sh
yarn release
```

This runs `typecheck` + `test`, bumps the version from the conventional commits
since the last tag, regenerates `CHANGELOG.md`, builds, tags, publishes to npm,
and creates a GitHub release.

## Reporting bugs

Please include your **OS and Node version**, whether you're using the native or
polling backend, and a minimal reproduction (a few lines of `watch(...)` plus the
filesystem operations). Watcher behavior is platform-divergent, so this detail
matters.
