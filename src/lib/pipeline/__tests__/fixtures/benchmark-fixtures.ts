import type { Shape } from "../../types";
import type { ColorRegion } from "../../vectorize";

export type BenchmarkFixture = {
  name: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  regions: ColorRegion[];
};

export function getBenchmarkFixtures(): BenchmarkFixture[] {
  return [
    twoColorLogoFixture(),
    iconWithHoleFixture(),
    noisyLowResolutionFixture(),
    multiColorBadgeFixture(),
    butterflyLineArtFixture(),
  ];
}

function twoColorLogoFixture(): BenchmarkFixture {
  return {
    name: "two-color-logo-thin-strokes",
    widthMm: 80,
    heightMm: 40,
    widthPx: 400,
    heightPx: 200,
    regions: [
      region(0, [25, 25, 25], [rect(30, 40, 240, 28), rect(30, 92, 180, 14)]),
      region(1, [210, 30, 40], [rect(270, 35, 48, 120), rect(325, 35, 48, 120)]),
    ],
  };
}

function iconWithHoleFixture(): BenchmarkFixture {
  return {
    name: "filled-icon-with-hole",
    widthMm: 60,
    heightMm: 60,
    widthPx: 300,
    heightPx: 300,
    regions: [
      region(0, [35, 80, 180], [{
        outer: [[45, 45], [255, 45], [255, 255], [45, 255]],
        holes: [[[115, 115], [185, 115], [185, 185], [115, 185]]],
      }]),
    ],
  };
}

function noisyLowResolutionFixture(): BenchmarkFixture {
  const shapes: Shape[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 6; x++) {
      if ((x + y) % 3 === 0) continue;
      shapes.push(rect(8 + x * 18, 8 + y * 16, 8 + ((x + y) % 2), 7));
    }
  }
  return {
    name: "noisy-low-resolution",
    widthMm: 45,
    heightMm: 35,
    widthPx: 120,
    heightPx: 90,
    regions: [region(0, [20, 20, 20], shapes)],
  };
}

function multiColorBadgeFixture(): BenchmarkFixture {
  return {
    name: "multi-color-adjacent-badge",
    widthMm: 70,
    heightMm: 70,
    widthPx: 350,
    heightPx: 350,
    regions: [
      region(0, [30, 110, 190], [rect(35, 35, 140, 280)]),
      region(1, [240, 190, 40], [rect(175, 35, 140, 280)]),
      region(2, [245, 245, 245], [rect(130, 130, 90, 90)]),
      region(3, [30, 30, 30], [rect(80, 290, 190, 18), rect(100, 65, 150, 12)]),
    ],
  };
}

function butterflyLineArtFixture(): BenchmarkFixture {
  return {
    name: "butterfly-line-art-c-00012",
    widthMm: 80,
    heightMm: 80,
    widthPx: 256,
    heightPx: 256,
    regions: [
      region(0, [0, 120, 255], [
        rect(18, 150, 145, 3),
        rect(45, 112, 92, 4),
        rect(80, 72, 72, 4),
        rect(150, 18, 14, 220),
        rect(170, 34, 18, 170),
        rect(32, 170, 60, 8),
        rect(22, 190, 48, 10),
      ]),
    ],
  };
}

function region(
  colorIndex: number,
  rgb: [number, number, number],
  shapes: Shape[],
): ColorRegion {
  return {
    colorIndex,
    rgb,
    svgPath: "",
    shapes,
    polygons: shapes.map((shape) => shape.outer),
  };
}

function rect(x: number, y: number, width: number, height: number): Shape {
  return {
    outer: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
    holes: [],
  };
}
