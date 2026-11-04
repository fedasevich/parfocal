import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Ring,
  ringArea,
  simplifyRing,
  traceContour,
  traceContours,
  traceMask,
} from "../src/aiseg/contour-trace.ts";

const SIZE = 40;

function ellipseMask(cx: number, cy: number, rx: number, ry: number, size = SIZE): Uint8Array {
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) mask[y * size + x] = 1;
    }
  }
  return mask;
}

function maskArea(mask: Uint8Array): number {
  return mask.reduce((sum, value) => sum + value, 0);
}

function inside(ring: Ring, px: number, py: number): boolean {
  const count = ring.length / 2;
  let hit = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2] ?? 0;
    const yi = ring[i * 2 + 1] ?? 0;
    const xj = ring[j * 2] ?? 0;
    const yj = ring[j * 2 + 1] ?? 0;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function coverage(ring: Ring, mask: Uint8Array, size = SIZE): number {
  const steps = 4;
  let covered = 0;
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          total++;
          if (inside(ring, x + (sx + 0.5) / steps, y + (sy + 0.5) / steps)) covered++;
        }
      }
    }
  }
  return covered / total;
}

function pixelCentreRing(mask: Uint8Array, size = SIZE): Ring {
  const boundary: [number, number][] = [];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      sx += x;
      sy += y;
      n++;
      const open =
        x === 0 ||
        y === 0 ||
        x === size - 1 ||
        y === size - 1 ||
        !mask[y * size + x - 1] ||
        !mask[y * size + x + 1] ||
        !mask[(y - 1) * size + x] ||
        !mask[(y + 1) * size + x];
      if (open) boundary.push([x + 0.5, y + 0.5]);
    }
  }
  const cx = sx / n + 0.5;
  const cy = sy / n + 0.5;
  boundary.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  return new Float32Array(boundary.flat());
}

const nuclei20x = [
  { name: "disc radius 4", cx: 20, cy: 20, rx: 4, ry: 4 },
  { name: "disc radius 5.5 off the grid", cx: 19.7, cy: 20.3, rx: 5.5, ry: 5.5 },
  { name: "disc radius 7", cx: 20.2, cy: 19.6, rx: 7, ry: 7 },
  { name: "ellipse 8 by 5", cx: 20, cy: 20, rx: 8, ry: 5 },
  { name: "ellipse 6 by 4", cx: 19.5, cy: 20.5, rx: 6, ry: 4 },
];

test("traced outlines cover at least 98% of the mask area at 20x", () => {
  for (const nucleus of nuclei20x) {
    const mask = ellipseMask(nucleus.cx, nucleus.cy, nucleus.rx, nucleus.ry);
    const ring = traceMask(mask, SIZE, SIZE);
    assert.ok(ring, nucleus.name);
    const ratio = ringArea(ring) / maskArea(mask);
    assert.ok(ratio >= 0.98 && ratio <= 1.03, `${nucleus.name} area ratio ${ratio.toFixed(4)}`);
  }
});

test("pixel-centre rings cover about 80% of the same masks, so the test can tell them apart", () => {
  const ratios = nuclei20x.map((nucleus) => {
    const mask = ellipseMask(nucleus.cx, nucleus.cy, nucleus.rx, nucleus.ry);
    return ringArea(pixelCentreRing(mask)) / maskArea(mask);
  });
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  assert.ok(mean > 0.7 && mean < 0.9, `mean pixel-centre area ratio ${mean.toFixed(3)}`);
  for (const ratio of ratios) assert.ok(ratio < 0.93);
});

test("traced outlines also hold most mask pixels and beat pixel-centre rings on every shape", () => {
  for (const nucleus of nuclei20x) {
    const mask = ellipseMask(nucleus.cx, nucleus.cy, nucleus.rx, nucleus.ry);
    const traced = coverage(traceMask(mask, SIZE, SIZE)!, mask);
    const centres = coverage(pixelCentreRing(mask), mask);
    assert.ok(traced >= 0.94, `${nucleus.name} traced pixel coverage ${traced.toFixed(4)}`);
    assert.ok(traced > centres, nucleus.name);
  }
});

test("a smooth logit field is traced at its sub-pixel zero crossing", () => {
  const radius = 6.37;
  const field = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      field[y * SIZE + x] = radius - Math.hypot(x - 20.4, y - 19.8);
    }
  }
  const ring = traceContour(field, SIZE, SIZE, 0)!;
  const count = ring.length / 2;
  for (let i = 0; i < count; i++) {
    const distance = Math.hypot(
      (ring[i * 2] ?? 0) - 0.5 - 20.4,
      (ring[i * 2 + 1] ?? 0) - 0.5 - 19.8,
    );
    assert.ok(Math.abs(distance - radius) < 0.1, `vertex ${i} off by ${distance - radius}`);
  }
  const ratio = ringArea(ring) / (Math.PI * radius * radius);
  assert.ok(ratio > 0.97 && ratio < 1.01, `area ratio ${ratio}`);
});

test("a mask touching the image border is closed along the border", () => {
  const mask = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 10; x++) mask[y * SIZE + x] = 1;
  }
  const ring = traceMask(mask, SIZE, SIZE)!;
  const ratio = ringArea(ring) / maskArea(mask);
  assert.ok(ratio > 0.9 && ratio <= 1.0, `area ratio ${ratio}`);
  assert.ok(coverage(ring, mask) > 0.9);
});

test("the largest ring comes first and an empty mask has no outline", () => {
  const mask = ellipseMask(12, 12, 4, 4);
  const small = ellipseMask(30, 30, 2, 2);
  small.forEach((value, index) => {
    if (value) mask[index] = 1;
  });
  const field = new Float32Array(mask);
  const rings = traceContours(field, SIZE, SIZE, 0.5);
  assert.equal(rings.length, 2);
  const [largest, smallest] = rings;
  assert.ok(largest && smallest && ringArea(largest) > ringArea(smallest));
  assert.equal(traceMask(new Uint8Array(SIZE * SIZE), SIZE, SIZE), null);
});

test("simplifying at 0.2 px drops vertices and keeps the area", () => {
  const mask = ellipseMask(20, 20, 9, 9);
  const ring = traceMask(mask, SIZE, SIZE)!;
  const simple = simplifyRing(ring, 0.2);
  assert.ok(simple.length < ring.length);
  assert.ok(Math.abs(ringArea(simple) - ringArea(ring)) / ringArea(ring) < 0.03);
  assert.ok(coverage(simple, mask) >= 0.97);
});
