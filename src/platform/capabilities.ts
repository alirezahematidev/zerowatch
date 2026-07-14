import os from "node:os";

/**
 * Whether `fs.watch(dir, { recursive: true })` is natively supported.
 *
 * Node implements recursive watching on macOS (FSEvents) and Windows
 * (ReadDirectoryChangesW). On Linux and most other platforms it throws
 * `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`, so we fall back to walking the tree and
 * placing one watcher per directory.
 *
 * @category Capabilities
 */
export const nativeRecursiveSupported: boolean =
  os.platform() === "darwin" || os.platform() === "win32";

/**
 * Whether native `move` detection via inode pairing is feasible on this
 * platform. inodes are reliable on Linux/macOS; on Windows `Stats.ino` is
 * synthesized and less dependable, so we degrade to delete+create there.
 *
 * @category Capabilities
 */
export const inodeMoveDetectionSupported: boolean = os.platform() !== "win32";
