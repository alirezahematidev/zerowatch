import type { Stats } from "node:fs";
import type { WatchEvent, WatchEventType } from "../types/events.js";
import { relativeTo } from "../utils/paths.js";

/**
 * Constructs normalized {@link WatchEvent}s. Centralizing this keeps path
 * derivation (relative vs absolute) consistent across the initial scan and the
 * live event stream.
 */
export class EventFactory {
  readonly #root: string;
  readonly #now: () => number;

  constructor(root: string, now: () => number) {
    this.#root = root;
    this.#now = now;
  }

  create(
    type: WatchEventType,
    absolutePath: string,
    isDirectory: boolean | undefined,
    stats?: Stats,
  ): WatchEvent {
    const relativePath = relativeTo(this.#root, absolutePath);
    return {
      type,
      path: relativePath,
      absolutePath,
      relativePath,
      timestamp: this.#now(),
      ...(isDirectory !== undefined ? { isDirectory } : {}),
      ...(stats !== undefined ? { stats } : {}),
    };
  }
}
