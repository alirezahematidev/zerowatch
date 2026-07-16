# Changelog

## 0.1.0 (2026-07-16)

### Features

* add ignoreHidden option to prune dotfiles/dot-folders ([e981ea8](https://github.com/alirezahematidev/zerowatch/commit/e981ea89e48aaf68a1a276a76418b1ddc0f113ae))
* add tag-triggered npm publish with provenance ([371e7d7](https://github.com/alirezahematidev/zerowatch/commit/371e7d753ce29b5c24292c9208458c467ab97ece))
* **bench:** optional adapters for parcel/watchpack/sane/raw fs.watch ([3c09f47](https://github.com/alirezahematidev/zerowatch/commit/3c09f474fdb81dd513e02d0637abd6bfd8b381d5))
* expose a drop event for maxBufferedEvents backpressure ([ef42a32](https://github.com/alirezahematidev/zerowatch/commit/ef42a3278bc144b8559b93af29dd65549e2f3bc7))
* FinalizationRegistry backstop for watchers dropped without close() ([bd37fc5](https://github.com/alirezahematidev/zerowatch/commit/bd37fc5980b14553d9cad4db5832c80baa4a1393))
* weak-reference platform sink so leak backstop can fire ([42ed40d](https://github.com/alirezahematidev/zerowatch/commit/42ed40d49452be5b3542d48df807288a7da4b397))

### Bug Fixes

* glob ** segment semantics, glob char-class escaping, polling symlink cycle ([3bf85df](https://github.com/alirezahematidev/zerowatch/commit/3bf85dfbd0494d273f1ca064e4054e47becc9103))
* production-hardening pass — 16 audit-confirmed correctness/reliability fixes ([f7d3beb](https://github.com/alirezahematidev/zerowatch/commit/f7d3bebe43f893b1593b754761b5757827009ccc))
* reset version ([163c0a5](https://github.com/alirezahematidev/zerowatch/commit/163c0a5935430a414febd805854194bae43c0008))
* three correctness bugs found in audit ([6cbf34e](https://github.com/alirezahematidev/zerowatch/commit/6cbf34e80edcae136400464138267816d7735557))

### Documentation

* add dev-only typedoc API reference generation ([c360bb8](https://github.com/alirezahematidev/zerowatch/commit/c360bb89990a7c8c6d82d24a9c6a5d6c360991cd))
* correct drop-signal location reference in TODOS ([e5602f2](https://github.com/alirezahematidev/zerowatch/commit/e5602f29663ce77e6901c77d3833106e4a9e4645))
* design spec for library TODOs ([#1](https://github.com/alirezahematidev/zerowatch/issues/1) leak net, [#3](https://github.com/alirezahematidev/zerowatch/issues/3) bench, [#4](https://github.com/alirezahematidev/zerowatch/issues/4) typedoc) ([41772c1](https://github.com/alirezahematidev/zerowatch/commit/41772c1259fa1ce806cd0922cdaffb979e3055af))
* drop completed library TODOs (leak net, bench, typedoc) ([0d712e3](https://github.com/alirezahematidev/zerowatch/commit/0d712e32b54a4966da16a5889ae8c455e3f8ecfb))
* mark virtual-fs dogfooding project done; note drop-signal feedback ([6a9ca6a](https://github.com/alirezahematidev/zerowatch/commit/6a9ca6a234406b5412e8962134a4e485a0d23fe5))
* organize typedoc API reference by topic + add examples ([e0f7210](https://github.com/alirezahematidev/zerowatch/commit/e0f72105ad27a5c58d20ee4f0f057212a40e39c7))

### Tests

* gated GC finalization test for the leak backstop ([025fb83](https://github.com/alirezahematidev/zerowatch/commit/025fb832a706a9d835a53d8c77f57ffa2f20da01))
* skip polling symlink-cycle test on Windows (symlink privileges) ([13d1653](https://github.com/alirezahematidev/zerowatch/commit/13d1653ef5bca43cb21bd60a3da0e559db96e821))

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are
generated from [Conventional Commits](https://www.conventionalcommits.org/) via
[release-it](https://github.com/release-it/release-it).

## [Unreleased]

### Features

- Dual **ESM + CommonJS** builds — `import` and `require` both supported.
- `getWatched()`, `add()`, and `unwatch()` for live watcher management.
- `usePolling` / `interval` polling backend for network filesystems, with a
  separate `binaryInterval` / `binaryExtensions` cadence for large assets.
- `depth` to cap recursion; `maxBufferedEvents` for async-iterator backpressure.
- `hashChanges` content-hash fallback for size/mtime/ctime-identical edits.
- Configurable `moveWindow`; `flushOnClose` to drain buffered events on close.
- `awaitWrite` now settles on size **and** mtime; symlink-cycle protection in the
  scanner; nested brace-expansion in ignore globs.

### Bug Fixes

- Ignored subtrees are now suppressed consistently on macOS/Windows.
- Fixed a close-during-startup race, an unhandled `ready()` rejection, a false
  same-path `move`, and `off()` not removing a pending `once()` listener.

### Build System

- Bundled with **tsup** (minified, ~21 KB/format — down from ~124 KB).
- Benchmarks rewritten on **tinybench** (warmup + multi-sample statistics).
