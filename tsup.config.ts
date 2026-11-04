import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "supabase/index": "src/supabase/index.ts",
    "adapters/index": "src/adapters/index.ts",
    "mediator/index": "src/mediator/index.ts",
    "ledger/index": "src/ledger/index.ts",
    "audit/index": "src/audit/index.ts",
    cli: "src/cli.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node18",
  shims: true,
  external: [
    "@supabase/supabase-js",
    "@mongodb-js/zstd",
    "pg",
    "mysql2",
    "mongodb",
    "better-sqlite3",
    "sqlite3",
    "ioredis",
    "redis",
    "@aws-sdk/client-s3"
  ]
});