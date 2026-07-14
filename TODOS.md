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

- [ ] **`virtual-fs` dogfooding project** — build a realistic, standalone app at
  `~/Desktop/projects/virtual-fs`: a React + Node.js **virtual file manager** for a
  given source directory. Its core (live tree, change/create/delete/move reflection,
  ignore rules, move detection, debounce/batch, backpressure) must be implemented
  **entirely on top of `zerowatch`**, exercising the library's full public API as a
  real end-to-end consumer. Serves two goals: (1) a thorough real-workload test of
  `zerowatch` beyond the unit/bench suite, and (2) a genuine second project.
  *Scope:* Node backend that watches the source dir via `zerowatch` and streams
  normalized events (WS/SSE) to a React UI that renders the live file tree; cover
  ignore globs/`.gitignore`, `depth`, `move` rendering, `awaitWrite`, and
  `maxBufferedEvents`. Feed any friction found back into `zerowatch` as issues/fixes.

---

## 💡 Possible future enhancements (not planned)

- `binaryInterval` heuristics beyond extension matching (e.g. sniffing content).
- A `depth` re-basing mode for independently-rooted `add()` targets.
- Configurable content-hash algorithm for `hashChanges` (currently SHA-1).
