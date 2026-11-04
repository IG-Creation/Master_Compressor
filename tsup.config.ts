import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "supabase/index": "src/supabase/index.ts",
    cli: "src/cli.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node18",
  shims: true,
  external: ["@supabase/supabase-js", "@mongodb-js/zstd"]
});
