#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const reportUrl = new URL("../docs/第二阶段优化记录.md", import.meta.url);

console.log("Phase 2 Benchmark Report");
console.log("========================");
console.log("");
console.log("Validated benchmark implementation:");
console.log("- src/lib/pipeline/benchmark.ts");
console.log("- src/lib/pipeline/__tests__/benchmark-smoke.test.ts");
console.log("");
console.log("Run the measured benchmark smoke test with:");
console.log("  npm run test -- benchmark-smoke");
console.log("");

if (existsSync(reportUrl)) {
  console.log("Saved report:");
  console.log(`  ${decodeURIComponent(reportUrl.pathname)}`);
  console.log("");
  const report = readFileSync(reportUrl, "utf8");
  const summary = report.match(/## 指标表[\s\S]*?(?=\n## |$)/);
  if (summary) {
    console.log(summary[0].trim());
  }
} else {
  console.log("Report file not found yet. Generate docs/第二阶段优化记录.md from the latest benchmark output.");
}
