# zerowatch

[![CI](https://github.com/alirezahematidev/zerowatch/actions/workflows/ci.yml/badge.svg)](https://github.com/alirezahematidev/zerowatch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/zerowatch.svg)](https://www.npmjs.com/package/zerowatch)
[![node](https://img.shields.io/node/v/zerowatch.svg)](https://www.npmjs.com/package/zerowatch)
[![license](https://img.shields.io/npm/l/zerowatch.svg)](./LICENSE)

> A modern, zero-dependency file watcher for Node.js.

- 🧭 Async-iterator first, with typed events and promise-based lifecycle.
- 📦 Zero runtime dependencies, ~25 KB minified, dual ESM + CommonJS.
- 🧰 Glob ignoring, debounce, batching, write-stability, polling.

## Install

```sh
npm install zerowatch
```

## Usage

```ts
import { watch } from "zerowatch";

const watcher = watch("src", { recursive: true });

// Async iterator (primary API)
for await (const event of watcher) {
  console.log(`${event.type}: ${event.relativePath}`);
}

// …or typed events
watcher.on("create", (e) => console.log("created", e.relativePath));
watcher.on("move", (e) => console.log("moved", e.oldPath, "→", e.absolutePath));
watcher.on("error", (err) => console.error(err));

await watcher.ready(); // initial scan complete
await watcher.close(); // release handles, end the iterator
```

Common options: `ignore`, `extensions`, `debounce`, `batch`, `gitignore`,
`awaitWrite`, `usePolling`. See [docs/API.md](docs/API.md) for the full reference.

## Benchmarks

Cold startup over a 5,000-file tree on macOS (run `yarn bench`):

| Watcher       | Startup    | Throughput       |
| ------------- | ---------- | ---------------- |
| **zerowatch** | **~58 ms** | ~8,800 events/s  |
| chokidar      | ~175 ms    | ~18,500 events/s |
| sane          | ~30 ms     | ~4,600 events/s  |

zerowatch reaches `ready` ~3× faster than chokidar with zero dependencies;
chokidar leads on sustained throughput (a deliberate ordering-correctness
tradeoff).

## Documentation

[API reference](docs/API.md) · [Migration guide](docs/MIGRATION.md) · [Examples](examples/) · [Changelog](CHANGELOG.md)

## License

MIT
