#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const reportUrl = new URL("../docs/中文变更记录.md", import.meta.url);

console.log("Phase 3 Line-Art Benchmark Report");
console.log("=================================");
console.log("");
console.log("Validated benchmark implementation:");
console.log("- src/lib/pipeline/benchmark.ts");
console.log("- src/lib/pipeline/__tests__/benchmark-smoke.test.ts");
console.log("- src/lib/pipeline/__tests__/fixtures/benchmark-fixtures.ts");
console.log("");
console.log("Run the measured benchmark smoke test with:");
console.log("  npm run test -- benchmark-smoke");
console.log("");
console.log("Line-art fixture:");
console.log("  butterfly-line-art-c-00012");
console.log("");
console.log("Phase 3 stroke fields:");
console.log("- strokeLikeObjectCount");
console.log("- fillUsedOnStrokeCount");
console.log("- beanRunObjectCount");
console.log("- satinStrokeObjectCount");
console.log("- runStitchRatio");
console.log("- satinStitchRatio");
console.log("- fillStitchRatio");
console.log("");

if (existsSync(reportUrl)) {
  console.log("Change log:");
  console.log(`  ${decodeURIComponent(reportUrl.pathname)}`);
  console.log("");
  const report = readFileSync(reportUrl, "utf8");
  const summary = report.match(/# 2026-06-27：第三阶段 Task 8[\s\S]*?(?=\n# |$)/);
  if (summary) {
    console.log(summary[0].trim());
  } else {
    console.log("Task 8 change-log entry has not been appended yet.");
  }
}
