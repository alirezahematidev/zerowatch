/**
 * Batching (arrays per window), debouncing, .gitignore and extension filters.
 */
import { watch } from "zerowatch";

const watcher = watch("src", {
  recursive: true,
  debounce: 100,
  batch: 200,
  gitignore: true,
  ignore: ["**/*.log", "**/dist/**"],
  extensions: [".ts", ".tsx"],
});

await watcher.ready();

// Because `batch` is set, the iterator yields WatchEvent[] (typed as arrays).
for await (const events of watcher) {
  console.log(`batch of ${events.length}:`);
  for (const event of events) {
    console.log(`  ${event.type} ${event.relativePath}`);
  }
}
