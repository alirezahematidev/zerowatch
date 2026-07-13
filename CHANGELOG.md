# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are
generated from [Conventional Commits](https://www.conventionalcommits.org/) via
[release-it](https://github.com/release-it/release-it).

## [Unreleased]

### Features

- Dual **ESM + CommonJS** builds — `import` and `require` both supported.
- `getWatched()`, `add()`, and `unwatch()` for live watcher management.
- `usePolling` / `interval` polling backend for network filesystems.
- Configurable `moveWindow`; `flushOnClose` to drain buffered events on close.
- `awaitWrite` now settles on size **and** mtime; symlink-cycle protection in the
  scanner; nested brace-expansion in ignore globs.

### Bug Fixes

- Ignored subtrees are now suppressed consistently on macOS/Windows.
- Fixed a close-during-startup race, an unhandled `ready()` rejection, a false
  same-path `move`, and `off()` not removing a pending `once()` listener.

### Build System

- Bundled with **tsup** (minified, ~19 KB/format — down from ~124 KB).
