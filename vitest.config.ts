import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      reportsDirectory: path.join(os.tmpdir(), "losslesspack-coverage"),
      clean: false,
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli.ts",
        "src/algorithms/index.ts",
        "src/algorithms/types.ts",
        "src/supabase/index.ts"
      ],
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 85,
        statements: 85
      }
    }
  }
});