#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "npm",
  ["run", "test", "--", "benchmark-smoke", "--reporter=verbose"],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
