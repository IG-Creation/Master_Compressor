#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

runCli(process.argv).then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
