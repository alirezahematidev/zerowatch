/**
 * Startup + throughput benchmarks, driven by tinybench for warmup, multiple
 * samples, and variance — so the numbers are trustworthy rather than a single
 * noisy reading.
 *
 *   npm run build && node bench/index.ts
 *
 * Benchmarks zerowatch, and — if `chokidar` happens to be installed — runs the
 * same scenarios against it for comparison. chokidar is NOT a dependency; the
 * comparison is skipped silently when it isn't present.
 */
import { Bench } from "tinybench";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "../dist/index.js";

const FILES = 5_000;
const DIRS = 50;
const EDITS = 1_000;

/** Minimal shape we rely on from any watcher under test. */
interface BenchWatcher {
  close(): Promise<unknown> | unknown;
}

function buildTree(): string {
  const root = mkdtempSync(join(tmpdir(), "zerowatch-bench-"));
  for (let d = 0; d < DIRS; d++) {
    const dir = join(root, `dir-${d}`);
    mkdirSync(dir);
    for (let f = 0; f < FILES / DIRS; f++) {
      writeFileSync(join(dir, `file-${f}.txt`), `content ${f}`);
    }
  }
  return root;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Edit EDITS distinct files (one write each) to exercise event throughput. */
function editDistinct(root: string): void {
  const perDir = FILES / DIRS;
  for (let i = 0; i < EDITS; i++) {
    const d = i % DIRS;
    const f = Math.floor(i / DIRS) % perDir;
    writeFileSync(join(root, `dir-${d}`, `file-${f}.txt`), `edited ${i} padding-${i}`);
  }
}

async function loadChokidar(): Promise<typeof import("chokidar") | null> {
  try {
    return await import("chokidar");
  } catch {
    return null;
  }
}

/** Adapters that create a ready watcher wired to `onEvent`, for each library. */
interface Adapter {
  readonly name: string;
  start(root: string, onEvent: () => void): Promise<BenchWatcher>;
}

function adapters(chokidar: typeof import("chokidar") | null): Adapter[] {
  const list: Adapter[] = [
    {
      name: "zerowatch",
      async start(root, onEvent) {
        const w = watch(root, { recursive: true, ignoreInitial: true });
        await w.ready();
        w.on("all", onEvent);
        return w;
      },
    },
  ];
  if (chokidar) {
    list.push({
      name: "chokidar",
      async start(root, onEvent) {
        const w = chokidar.watch(root, { ignoreInitial: true });
        await new Promise<void>((resolve) => w.on("ready", () => resolve()));
        w.on("all", onEvent);
        return w;
      },
    });
  }
  return list;
}

/** Startup: cold time to `ready` over the whole tree (one watch cycle / task). */
async function runStartup(tree: string, libs: Adapter[]): Promise<void> {
  const bench = new Bench({ name: "startup", time: 3_000, warmupIterations: 2 });
  for (const lib of libs) {
    bench.add(lib.name, async () => {
      const w = await lib.start(tree, () => {});
      await w.close();
    });
  }
  await bench.run();
  console.log(`\nStartup — time to ready over ${FILES} files (lower is better):`);
  console.table(bench.table());
}

/** Throughput: time to deliver EDITS events after editing EDITS distinct files. */
async function runThroughput(tree: string, libs: Adapter[]): Promise<void> {
  const bench = new Bench({ name: "throughput", time: 4_000, warmupIterations: 1 });

  for (const lib of libs) {
    // Per-task state, captured by the hooks and the task fn below.
    let watcher: BenchWatcher | null = null;
    let received = 0;
    let resolveBatch: () => void = () => {};

    bench.add(
      lib.name,
      async () => {
        received = 0;
        const delivered = new Promise<void>((resolve) => {
          resolveBatch = resolve;
        });
        editDistinct(tree);
        // Resolve once all events arrive; cap so a coalescing OS can't hang it.
        await Promise.race([delivered, sleep(5_000)]);
      },
      {
        beforeAll: async () => {
          watcher = await lib.start(tree, () => {
            received += 1;
            if (received >= EDITS) resolveBatch();
          });
        },
        afterEach: async () => {
          await sleep(150); // let stragglers drain before the next sample
        },
        afterAll: async () => {
          await watcher?.close();
          watcher = null;
        },
      },
    );
  }

  await bench.run();
  console.log(`\nThroughput — deliver ${EDITS} events (higher events/s is better):`);
  console.table(
    bench.tasks.map((task) => {
      const result = task.result;
      const hasStats = result != null && "latency" in result;
      const opsPerSec = hasStats ? result.throughput.mean : 0; // batches/s
      return {
        library: task.name,
        "events/s": Math.round(opsPerSec * EDITS).toLocaleString(),
        "batch avg (ms)": hasStats ? result.latency.mean.toFixed(1) : "n/a",
        samples: hasStats ? result.latency.samplesCount : 0,
      };
    }),
  );
}

async function main(): Promise<void> {
  const chokidar = await loadChokidar();
  if (!chokidar) console.log("chokidar not installed — running zerowatch only.\n");

  console.log(`Building tree: ${FILES} files across ${DIRS} dirs …`);
  const startupTree = buildTree();
  try {
    await runStartup(startupTree, adapters(chokidar));
  } finally {
    rmSync(startupTree, { recursive: true, force: true });
  }

  const tputTree = buildTree();
  try {
    await runThroughput(tputTree, adapters(chokidar));
  } finally {
    rmSync(tputTree, { recursive: true, force: true });
  }
}

await main();
