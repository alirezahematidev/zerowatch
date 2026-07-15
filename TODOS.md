# zerowatch — TODOs & Improvement Backlog

---

## 📐 Design decisions (intentional, not open tasks)

### Synchronous event classification

**Where:** [src/core/classifier.ts](src/core/classifier.ts)

The classifier `stat`s each raw notification **synchronously**. This guarantees
strict per-path event ordering and keeps the pipeline simple. It also means
sustained throughput on a hot micro-benchmark trails chokidar (~11k vs ~16k
ev/s), while cold-start is ~2.6× faster.

An async classification stage (bounded `fs.stat` pool) could close that gap, but
only safely if it preserves per-path ordering — a substantial change for an
uncertain, workload-dependent win. **Decision: keep synchronous classification.**
Revisit only if a real workload (not a micro-benchmark) shows classification is
the bottleneck; if so, gate the async path behind an opt-in and benchmark it.

### Depth relative to the primary root

`depth` is measured from the watcher's primary root. Paths attached later via
`add()` that live outside that root are watched in full (depth is not re-based per
added target). This keeps the common single-root case simple; revisit if
multi-root depth semantics are requested.

---

## ▶ Planned

Nothing open right now.

---

## ✅ Done

- [x] **`virtual-fs` dogfooding project** — built at `~/Desktop/projects/virtual-fs`:
  a React + Node **virtual file manager** whose whole core (live tree,
  create/change/delete/move, ignore rules, move detection, debounce/batch,
  backpressure) runs entirely on `zerowatch`'s public API. A Node/`ws` server pumps
  the watcher's **async iterator** to a React UI that rebuilds the tree purely from
  the event stream; the browser controls the watcher over WebSocket (root, ignore
  globs/`.gitignore`, `depth`, `awaitWrite`, polling, `maxBufferedEvents`, pause/
  resume). Friction fed back: `maxBufferedEvents` drops were silent — added a public
  `drop` event to zerowatch (see the `feat/drop-signal` branch) so the app can show
  an accurate dropped-event count.

---

## 💡 Possible future enhancements (not planned)

- `binaryInterval` heuristics beyond extension matching (e.g. sniffing content).
- A `depth` re-basing mode for independently-rooted `add()` targets.
- Configurable content-hash algorithm for `hashChanges` (currently SHA-1).
