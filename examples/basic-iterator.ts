/**
 * The primary API: consume events as an async stream.
 *
 *   node --experimental-strip-types examples/basic-iterator.ts ./src
 */
import { watch } from "zerowatch";

const target = process.argv[2] ?? "src";

const watcher = watch(target, { recursive: true, ignore: ["**/node_modules/**"] });

console.log(`watching ${target} … (edit files, Ctrl+C to stop)`);

process.on("SIGINT", () => void watcher.close().then(() => process.exit(0)));

for await (const event of watcher) {
  console.log(`${event.type.padEnd(6)} ${event.relativePath}`);
}
