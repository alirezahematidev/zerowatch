import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // File-system watching tests are timing sensitive; run them serially
    // within a file and avoid parallel file execution stealing FS events.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types/**"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
