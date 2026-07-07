import { describe, expect, it } from "vitest";
import { buildObjects } from "../build-objects";
import { makeDefaultConfig } from "../config";
import { FABRIC_PROFILES } from "../fabric";
import { optimizeOrder } from "../pathing";
import { TRIM_POLICY_BY_FORMAT } from "../policy";
import { renderDesign } from "../render";
import { analyzePattern } from "../stats";
import { runBenchmarkFixture } from "../benchmark";
import { getBenchmarkFixtures } from "./fixtures/benchmark-fixtures";

describe("pipeline benchmark smoke fixtures", () => {
  it("renders deterministic fixtures within generous bounds", () => {
    const config = makeDefaultConfig("denim");

    const rows: Array<Record<string, string | number>> = [];

    for (const fixture of getBenchmarkFixtures()) {
      const started = performance.now();
      const fabric = FABRIC_PROFILES.denim;
      const objects = buildObjects({
        regions: fixture.regions,
        widthMm: fixture.widthMm,
        widthPx: fixture.widthPx,
        heightPx: fixture.heightPx,
        fabric,
        satinMaxWidthMm: config.satinMaxWidthMm,
        minRegionAreaPx: config.minRegionAreaPx,
        removeWhiteBackground: config.removeWhiteBackground,
      });
      const optimized = optimizeOrder({
        widthMm: fixture.widthMm,
        heightMm: fixture.heightMm,
        fabric,
        objects,
      });
      const pattern = renderDesign(optimized, {
        widthMm: fixture.widthMm,
        heightMm: fixture.heightMm,
        widthPx: fixture.widthPx,
        stitchDensityMm: config.stitchDensity,
        satinMaxWidthMm: config.satinMaxWidthMm,
        fillAngleDeg: config.fillAngleDeg,
        fillStrategy: config.fillStrategy,
        fabric,
        policy: TRIM_POLICY_BY_FORMAT.dst,
      });
      const stats = analyzePattern(pattern);
      const elapsedMs = performance.now() - started;

      rows.push({
        fixture: fixture.name,
        objects: objects.length,
        stitches: stats.stitchCount,
        jumps: stats.jumpCount,
        trims: stats.trimCount,
        travelMm: Number(stats.travelLengthMm.toFixed(1)),
        elapsedMs: Number(elapsedMs.toFixed(2)),
      });

      expect(objects.length, `${fixture.name}: object count`).toBeGreaterThan(0);
      expect(stats.stitchCount, `${fixture.name}: stitch count`).toBeGreaterThan(0);
      expect(stats.stitchCount, `${fixture.name}: stitch cap`).toBeLessThan(20_000);
      expect(stats.maxStitchLengthMm, `${fixture.name}: max stitch length`).toBeLessThan(80);
      expect(elapsedMs, `${fixture.name}: elapsed`).toBeLessThan(1_000);
    }

    console.table(rows);
  });

  it("reports phase 2 benchmark fields", () => {
    const [fixture] = getBenchmarkFixtures();
    const row = runBenchmarkFixture(fixture, makeDefaultConfig("denim"));

    expect(row.fixture).toBe(fixture.name);
    expect(row.objectCount).toBeGreaterThan(0);
    expect(row.layerCount).toBeGreaterThan(0);
    expect(row.stitchCount).toBeGreaterThan(0);
    expect(row.jumpCount).toBeGreaterThanOrEqual(0);
    expect(row.jumpRatio).toBeGreaterThanOrEqual(0);
    expect(row.stopCount).toBeGreaterThanOrEqual(0);
    expect(row.trimCount).toBeGreaterThanOrEqual(0);
    expect(row.travelLengthMm).toBeGreaterThanOrEqual(0);
    expect(row.maxJumpMm).toBeGreaterThanOrEqual(0);
    expect(row.generationTimeMs).toBeGreaterThanOrEqual(0);
    expect(row.dstSizeBytes).toBeGreaterThan(512);
    expect(row.strokeLikeObjectCount).toBeGreaterThanOrEqual(0);
    expect(row.fillUsedOnStrokeCount).toBeGreaterThanOrEqual(0);
    expect(row.runStitchRatio).toBeGreaterThanOrEqual(0);
    expect(row.beanRunObjectCount).toBeGreaterThanOrEqual(0);
    expect(row.satinStitchRatio).toBeGreaterThanOrEqual(0);
    expect(row.fillStitchRatio).toBeGreaterThanOrEqual(0);
  });

  it("reports stroke metrics for the line-art butterfly fixture", () => {
    const fixture = getBenchmarkFixtures().find((item) =>
      item.name === "butterfly-line-art-c-00012",
    );
    expect(fixture).toBeDefined();

    const row = runBenchmarkFixture(fixture!, makeDefaultConfig("denim"));

    expect(row.strokeLikeObjectCount).toBeGreaterThan(0);
    expect(row.beanRunObjectCount + row.satinStrokeObjectCount).toBeGreaterThan(0);
    expect(row.runStitchRatio + row.satinStitchRatio + row.fillStitchRatio).toBeCloseTo(1, 1);
  });

  it("keeps hole-bearing fill travel within a reasonable trim budget", () => {
    const fixture = getBenchmarkFixtures().find((item) =>
      item.name === "filled-icon-with-hole",
    );
    expect(fixture).toBeDefined();

    const row = runBenchmarkFixture(fixture!, makeDefaultConfig("denim"));

    expect(row.trimCount).toBeLessThanOrEqual(20);
    expect(row.travelLengthMm).toBeLessThan(820);
  });
});
