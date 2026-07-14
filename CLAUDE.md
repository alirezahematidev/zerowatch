# CLAUDE.md

Guidance for Claude (and a quick orientation for contributors) when working in
this repository.

## What this is

`zerowatch` — a modern, **zero-runtime-dependency**, dual ESM/CommonJS file
watcher for Node.js (≥20). Public API entry points are `watch`,
`watch.file`, `watch.directory`, and `createWatcher`, all returning a `Watcher`
that is both an event emitter and an async iterable.

## Hard constraints

- **No runtime dependencies.** `package.json` `dependencies` must stay empty.
  Everything ships built-in. Dev/optional tools (bench comparisons, typedoc) are
  `devDependencies` or optional imports guarded by `try/catch`.
- **ESM with explicit `.js` import specifiers** even in `.ts` source
  (`import { x } from "./foo.js"`). `verbatimModuleSyntax` is on — use
  `import type` for type-only imports.
- **Node ≥20.** `WeakRef`/`FinalizationRegistry` are relied upon.
- **Cross-platform.** Behavior differs by OS; don't assume one platform.

## Commands

```sh
yarn build          # tsup → dist (ESM + CJS + d.ts)
yarn typecheck      # tsc --noEmit
yarn test           # vitest run
yarn test:coverage  # vitest run --coverage
yarn bench          # build, then node bench/index.ts
yarn docs:api       # typedoc → docs/api (gitignored, published via CI)
yarn attw           # verify published types (are-the-types-wrong)
```

Run the GC-gated leak test locally with GC exposed:

```sh
NODE_OPTIONS=--expose-gc yarn vitest run test/leak.test.ts
```

## Architecture (src/)

- `core/watcher.ts` — orchestrates the pipeline: classify → move-detect →
  await-write → debounce → batch → deliver (events + async iterator).
- `core/classifier.ts` — turns raw fs notifications into normalized events by
  `stat`-ing synchronously (deliberate; see TODOS.md design decisions).
- `core/leak-registry.ts` — `FinalizationRegistry` backstop for watchers
  dropped without `close()`.
- `platform/` — backend adapters selected per OS: native recursive
  (macOS/Windows), manual per-directory (Linux), single-file, and polling.
  `weak-sink.ts` weakly references the sink so an active `fs.watch` handle
  never pins the owning `Watcher` (that's what lets the leak backstop fire).
- `ignore/` — glob compiler, `.gitignore` parser, and the combined engine.
- `events/`, `debounce/`, `batch/`, `scanner/` — pipeline stages.

## Conventions

- Match the surrounding code's style, comment density, and naming.
- TDD: add a failing test first, then the fix. Tests live in `test/*.test.ts`
  and use the helpers in `test/helpers.ts`. FS-watch tests are timing-sensitive
  and run serially (`fileParallelism: false`).
- Guard OS-specific tests (e.g. symlink creation is privileged on Windows —
  `describe.skipIf(process.platform === "win32")`).
- Conventional Commits for messages (`feat`, `fix`, `test`, `docs`, …).

## Docs

- `docs/API.md` — hand-written narrative guide (keep current).
- `docs/api/` — generated typedoc (gitignored; published to GitHub Pages by CI).
- `TODOS.md` — backlog and intentional design decisions.
