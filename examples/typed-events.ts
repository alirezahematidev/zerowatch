/**
 * Typed event listeners, including move detection and error handling.
 */
import { watch } from "watchx";

const watcher = watch("src");

watcher
  .on("create", (e) => console.log("＋ create", e.relativePath))
  .on("change", (e) => console.log("～ change", e.relativePath))
  .on("delete", (e) => console.log("－ delete", e.relativePath))
  .on("move", (e) => console.log("→ move  ", e.oldPath, "→", e.absolutePath))
  .on("error", (err) => console.error("! error ", err.message));

await watcher.ready();
console.log("ready — initial scan complete");

// Later, when shutting down:
// await watcher.close();
