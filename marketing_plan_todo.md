# zerowatch — Marketing & Launch Plan

> Analyzed, categorized, and prioritized for **zerowatch**: a modern, zero-dependency,
> dual ESM/CJS file watcher for Node.js (a chokidar alternative). Node.js ≥ 20.
>
> **Role:** senior DevRel engineer. **Goal:** help Node.js/TypeScript developers
> discover, trust, and adopt the package → maximize downloads, GitHub stars, and
> long-term adoption.

---

## 0. Current state (read this first)

The package is **strong technically but has zero market presence**. Analysis of the repo found:

- 🔴 **Not published to npm.** `npm view zerowatch` and `npm view watchery` both 404.
  Nothing else on this list matters until the package installs.
- 🔴 **Name is unresolved.** `package.json` name is `zerowatch`; the repo folder is
  `watchery`. Every marketing asset (keywords, description, pitch, SEO) depends on
  picking one. **Recommendation: keep `zerowatch`** — it's already in the README,
  docs, CONTRIBUTING, and source headers; "watchery" would mean rewriting all of them.
  Both names are free on npm. → **Needs a one-line sign-off before Phase 1.**
- 🟡 **No visual/social proof.** No badges, no logo, no demo GIF, no stars/downloads
  to show. First-time visitors have nothing to build trust quickly.
- 🟢 **Product & docs are genuinely good** (see strengths). This is a distribution
  problem, not a quality problem — which is the good kind to have.

**Target audience (primary → secondary):**

1. **Node.js / TypeScript library & tooling authors** (build tools, dev servers, linters, hot-reloaders) — they feel chokidar's dependency weight and want types.
2. **Framework / bundler maintainers** evaluating watch layers (Vite-adjacent, CLI tools).
3. **App developers** who need reliable file watching (uploads, sync, live-reload).

---

## 1. Package analysis — strengths & weaknesses

### Strengths

- **Zero runtime dependencies** — a real, marketable differentiator vs chokidar's transitive deps.
- **Modern API** — async-iterator-first, promises for lifecycle, fully typed, no `any`.
- **Dual ESM + CJS** with a correct `exports` map (verified via `attw` in CI).
- **Cross-platform correctness** — normalized 4-event model, inode move detection, documented per-OS strategy.
- **Serious engineering hygiene** — 3-OS × 2-Node CI matrix, coverage, benchmarks (tinybench), CHANGELOG, CONTRIBUTING, MIGRATION guide, examples.
- **Honest benchmarks** — publishes where it loses (sustained throughput), which builds trust.
- **Fast cold start** — ~3× faster `ready()` than chokidar on 5k files; a concrete, quotable number.

### Weaknesses (marketing-facing)

- **Not discoverable** — unpublished, no badges, no downloads/stars, no social footprint.
- **No visuals** — README is text-only; no logo, GIF, or terminal demo.
- **Benchmark scope is narrow** — only vs chokidar (TODOS already plans @parcel/watcher, watchpack, sane).
- **No hosted API docs / site** — only hand-written Markdown (typedoc is planned but not done).
- **No proof of real-world use** — the `virtual-fs` dogfooding demo in TODOS.md would fix this.
- **npm keywords are decent but thin** on high-intent terms (see #3/#14).

---

## 20. Scorecard (1–10, current state)

| Dimension | Score | Note |
| --- | :---: | --- |
| Discoverability | **1** | Unpublished; no npm/Google/GitHub-search presence. |
| Documentation | **9** | Excellent README, API.md, MIGRATION.md, examples, CONTRIBUTING. |
| Developer Experience | **8** | Clean, modern, typed API; needs a runnable demo to seal it. |
| API Design | **9** | Async-iterator-first + typed events is best-in-class ergonomics. |
| Marketing | **1** | No assets, no launch, no channels engaged. |
| GitHub Repository | **6** | Great internals; missing badges, logo, topics, Discussions, pinned demo. |
| npm Page | **1** | Does not exist yet. |
| Overall Adoption Potential | **8** | High ceiling — quality is there; distribution is the gap. |

**Re-score target after Phase 1–2:** Discoverability 6, Marketing 6, GitHub 8, npm 8.

---

## Deliverables → categorized

The 20 requested deliverables group into five workstreams. Priority: **P0 blocker → High → Medium → Low**.

### A. Ship & foundation (P0 — nothing works without these)

- [ ] **Resolve the name** (`zerowatch` recommended) and align folder/package/docs.  → *decision*
- [ ] **Publish v0.1.0 to npm** (`prepublishOnly` build already wired). → deliverable enabler
- [ ] **#3 npm description + keywords** — tighten before publish (see below).
- [ ] **#4 GitHub repo description** + topics.
- [ ] **#19 Badges** (npm version, downloads, CI, license, bundle size, types) in README.
- [ ] **#2 README rewrite** — already ~90% there; add badges, logo, demo GIF, social proof slots.

### B. Positioning & core copy (High — reused everywhere)

- [ ] **#5 Elevator pitch** (one sentence).
- [ ] **#16 Competitor comparison table** (vs chokidar, @parcel/watcher, node:fs.watch, watchpack, nodemon/sane).
- [ ] **#14 SEO keywords** developers actually search.
- [ ] **#15 Community map** (where to share).

### C. Launch content (High/Medium — write once, schedule)

- [ ] **#7 Dev.to article** (problem → solution; the anchor long-form piece).
- [ ] **#6 Product Hunt** launch description.
- [ ] **#10 Reddit** feedback-first post (r/node, r/javascript, r/typescript).
- [ ] **#8 LinkedIn** post.
- [ ] **#9 X/Twitter** thread.
- [ ] **#11 YouTube** video ideas & titles.

### D. Repo/DX polish that drives installs & stars (Medium)

- [ ] **#17 Install/star-conversion improvements** (demo GIF, quickstart-in-10-lines, StackBlitz).
- [ ] **#18 Standout features** (roadmap-worthy; see below).
- [ ] **#19 (cont.)** hosted typedoc site, runnable demo, screenshots — from TODOS.md.

### E. Cadence & tracking (High to set up, then ongoing)

- [ ] **#12 First-week launch checklist.**
- [ ] **#13 30-day marketing plan.**
- [ ] Final: **prioritized action plan** (this file's Phase table).

---

## Concrete copy (ready to use once name is signed off)

### #3 npm description + keywords

- **Description:** `Modern, zero-dependency file watcher for Node.js — async-iterator API, typed events, and normalized create/change/delete/move across macOS, Windows & Linux.`
- **Add keywords:** `file-watcher`, `chokidar-alternative`, `fs.watch`, `hot-reload`, `live-reload`, `recursive-watch`, `watch-files`, `async-iterator`, `zero-dependency`, `nodejs`, `cross-platform`, `move-detection`. (Keep existing `watch`, `fsevents`, `esm`, `typescript`.)

### #4 GitHub repo description

`⚡ Zero-dependency, fully-typed file watcher for Node.js. Async-iterator API + normalized create/change/delete/move events. A modern chokidar alternative.`

Topics: `file-watcher`, `chokidar`, `nodejs`, `typescript`, `fs`, `fsevents`, `esm`, `async-iterator`, `cross-platform`, `zero-dependency`.

### #5 Elevator pitch

`zerowatch is a zero-dependency, fully-typed file watcher for Node.js that gives you a clean async-iterator API and normalized create/change/delete/move events on every OS.`

### #16 Comparison table (draft — verify each cell before publishing)

| | zerowatch | chokidar | @parcel/watcher | node:fs.watch |
| --- | :---: | :---: | :---: | :---: |
| Runtime deps | **0** | `readdirp` | native prebuilds | 0 |
| Async-iterator API | ✅ | ❌ | ❌ | ❌ |
| Typed events (no `any`) | ✅ | partial | partial | ❌ |
| Normalized move detection | ✅ (inode) | ❌ | ❌ | ❌ |
| ESM + CJS dual | ✅ | ✅ | ✅ | n/a |
| Cold start (5k files) | **~58ms** | ~175ms | verify | fast/raw |
| Recursive on Linux | ✅ (managed) | ✅ | ✅ | ❌ |

### #14 SEO keywords (search intent)

`node file watcher`, `chokidar alternative`, `zero dependency file watcher`, `typescript file watcher`, `fs.watch recursive`, `watch files node async iterator`, `detect file rename node`, `node hot reload library`, `esm file watcher`, `cross platform file watching node`.

### #15 Communities to share

- **Reddit:** r/node, r/javascript, r/typescript (feedback-first, no spam).
- **Hacker News:** Show HN once README + demo are polished (one shot — make it count).
- **Discord:** Reactiflux (#nodejs), Nodejs, TypeScript Community.
- **GitHub:** enable Discussions; post in chokidar-alternative discussions where appropriate.
- **Dev.to / Hashnode:** cross-post the article. **Lobste.rs**, **Bluesky/X #nodejs**.
- Newsletters (submit): **Node Weekly**, **JavaScript Weekly**, **Bytes**.

### #18 Standout feature ideas (from analysis + TODOS.md)

- `virtual-fs` live demo app (already in TODOS) — best single trust-builder.
- Hosted typedoc API site + StackBlitz "try it" link.
- Extended benchmark suite vs @parcel/watcher, watchpack, sane (already planned).
- `FinalizationRegistry` leak safety-net (planned) — a nice "we sweat the details" story.

---

## Prioritized execution plan (phases)

| Phase | Priority | Tasks | Deliverables | Outcome |
| --- | --- | --- | --- | --- |
| **P0 — Ship** | 🔴 Critical | Confirm name → align repo → tighten npm desc/keywords → `npm publish` v0.1.0 → repo description + topics → add badges | A: #3, #4, #19(badges) | Installable + discoverable baseline |
| **1 — Trust** | 🔴 High | README polish (badges, logo, demo GIF, quickstart) → elevator pitch → comparison table → SEO keyword list → enable GitHub Discussions | A/B: #2, #5, #16, #14 | Visitor converts to install/star |
| **2 — Launch content** | 🟠 High | Dev.to article → Product Hunt copy → Reddit feedback post → LinkedIn → X thread → YouTube titles | C: #6–#11 | Assets ready to publish |
| **3 — Launch week** | 🟠 High | Execute first-week checklist across community map; submit to Node/JS Weekly; Show HN | E: #12, #15 | Initial traffic + feedback loop |
| **4 — Sustain** | 🟡 Medium | Run 30-day plan; build `virtual-fs` demo; hosted typedoc; extended benchmarks; iterate on feedback | D/E: #13, #17, #18, #19 | Compounding adoption |

### #12 First-week launch checklist

- Day 0: publish npm, tag GitHub release, verify install on a clean machine, badges live.
- Day 1: publish Dev.to article; cross-post Hashnode/Medium.
- Day 2: Reddit feedback post (r/node) — respond to every comment.
- Day 3: X thread + LinkedIn post; pin repo demo.
- Day 4: Product Hunt launch (Tue–Thu best).
- Day 5: Show HN (only if README + demo are solid).
- Day 6: submit to Node Weekly / JavaScript Weekly.
- Day 7: retro — collect feedback into GitHub issues; note what converted.

### #13 30-day plan (summary)

- **Week 1:** launch (above) + respond everywhere; fix top friction from feedback.
- **Week 2:** ship `virtual-fs` demo + hosted API docs; publish "how move detection works" deep-dive.
- **Week 3:** extended benchmarks post; record a YouTube demo; engage in 3 relevant GitHub discussions/issues.
- **Week 4:** comparison/migration content ("migrating from chokidar in 5 min"); measure downloads/stars; plan v0.2 from feedback.

### #11 YouTube ideas

- "I built a zero-dependency chokidar alternative — here's why" (5–8 min).
- "File watching in Node with async iterators (no chokidar)" (tutorial).
- "Detecting file moves correctly on every OS" (deep dive).

---

## What I'll do next (autonomous)

Blocked only on the **name sign-off**. Once confirmed I can, in order:

1. Align package/folder/docs to the final name.
2. Update npm description + keywords in `package.json`.
3. Add the badge block, elevator pitch, and comparison table to README.md.
4. Draft the Dev.to article and all social copy as files under `docs/marketing/`.
5. Write the launch checklist + 30-day plan as a tracked issue set.

Publishing to npm and posting to external communities are **your** actions (they require your accounts/credentials) — I'll prep everything up to the publish/post button.
