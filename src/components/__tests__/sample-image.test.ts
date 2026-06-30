import { describe, expect, test } from "vitest";
import { resolveSampleImageFromSearch } from "../sample-image";

describe("resolveSampleImageFromSearch", () => {
  test("returns local sample paths", () => {
    expect(resolveSampleImageFromSearch("?sample=/phase3-samples/c_00012.png")).toBe(
      "/phase3-samples/c_00012.png",
    );
  });

  test("rejects non-local sample URLs", () => {
    expect(resolveSampleImageFromSearch("?sample=https://example.com/a.png")).toBeNull();
    expect(resolveSampleImageFromSearch("?sample=//example.com/a.png")).toBeNull();
  });
});
