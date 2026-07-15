import os from "node:os";

/**
 * Whether `fs.watch(dir, { recursive: true })` is natively supported.
 *
 * Node implements recursive watching on macOS (FSEvents) and Windows
 * (ReadDirectoryChangesW). On Linux and most other platforms it throws
 * `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`, so we fall back to walking the tree and
 * placing one watcher per directory.
 */
export const nativeRecursiveSupported: boolean =
  os.platform() === "darwin" || os.platform() === "win32";

/**
 * Whether native `move` detection via inode pairing is feasible on this
 * platform. inodes are reliable on Linux/macOS; on Windows `Stats.ino` is
 * synthesized and less dependable, so we degrade to delete+create there.
 */
export const inodeMoveDetectionSupported: boolean = os.platform() !== "win32";

/**
 * Whether the platform's default filesystem is case-insensitive. macOS (APFS/
 * HFS+ default) and Windows (NTFS) compare names case-insensitively, so ignore
 * globs are matched case-insensitively there to stay consistent with the OS and
 * with the always-case-insensitive extension allow-list. Linux (ext4, etc.) is
 * case-sensitive. This is a platform heuristic; an individual volume may differ.
 */
export const caseInsensitiveFs: boolean =
  os.platform() === "darwin" || os.platform() === "win32";
