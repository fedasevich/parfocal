import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import {
  aisInstances,
  gaussianBlur,
  labelComponents,
  markerWatershed,
} from "../src/aiseg/ais-instances.ts";
import { ringArea } from "../src/aiseg/contour-trace.ts";
import { fakeAisMaps as discMaps } from "../src/aiseg/fake-sam.ts";

describe("AIS post-processing", () => {
  it("keeps a constant field unchanged when blurring with mirrored edges", () => {
    const blurred = gaussianBlur(new Float32Array(64).fill(0.7), 8, 8, 1.6);
    for (const value of blurred) assert.ok(Math.abs(value - 0.7) < 1e-5);
  });

  it("labels four-connected components only", () => {
    const mask = Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0, 1]);
    assert.equal(labelComponents(mask, 3, 3).count, 5);
    assert.equal(labelComponents(Uint8Array.from([1, 1, 0, 1]), 2, 2).count, 1);
  });

  it("floods every masked pixel from the markers by rising surface", () => {
    const surface = Float32Array.from([0, 1, 2, 1, 0]);
    const markers = Int32Array.from([1, 0, 0, 0, 2]);
    const labels = markerWatershed(surface, markers, Uint8Array.from([1, 1, 1, 1, 1]), 5);
    assert.deepEqual(Array.from(labels), [1, 1, 1, 2, 2]);
  });

  it("splits two touching nuclei into two outlines at the right place", () => {
    const maps = discMaps(64, 64, [
      { x: 22, y: 32, r: 9 },
      { x: 39, y: 32, r: 9 },
    ]);
    const found = aisInstances(maps, 64, 64);
    assert.equal(found.length, 2);
    const xs = found.map((instance) => instance.centroid.x).sort((a, b) => a - b);
    assert.ok(Math.abs((xs[0] ?? 0) - 22) < 1.5);
    assert.ok(Math.abs((xs[1] ?? 0) - 39) < 1.5);
    for (const instance of found) assert.ok(instance.score > 0.5);
  });

  it("traces a square in pixel-centre coordinates so its ring covers the same pixels", () => {
    const plane = 40 * 40;
    const maps = new Float32Array(plane * 3).fill(1);
    for (let y = 10; y < 20; y++) {
      for (let x = 10; x < 20; x++) {
        maps[y * 40 + x] = 1;
        const edge = Math.min(x - 10, 19 - x, y - 10, 19 - y);
        maps[plane + y * 40 + x] = edge >= 3 ? 0 : 1;
        maps[plane * 2 + y * 40 + x] = edge >= 3 ? 0 : 1;
      }
    }
    for (let i = 0; i < plane; i++) {
      const x = i % 40;
      const y = Math.floor(i / 40);
      if (x < 10 || x >= 20 || y < 10 || y >= 20) maps[i] = 0;
    }
    const [square] = aisInstances(maps, 40, 40);
    assert.ok(square);
    assert.ok(square.area >= 90 && square.area <= 100);
    assert.ok(Math.abs(square.centroid.x - 14.5) < 1e-9);
    const xs = Array.from(square.ring).filter((_, i) => i % 2 === 0);
    assert.ok(Math.abs(Math.min(...xs) - 9.5) < 0.3);
    assert.ok(Math.abs(Math.max(...xs) - 19.5) < 0.3);
    assert.ok(Math.abs(ringArea(square.ring) - 100) < 12);
  });

  it("drops instances under the minimum area", () => {
    const maps = discMaps(32, 32, [{ x: 16, y: 16, r: 2 }]);
    assert.equal(aisInstances(maps, 32, 32).length, 0);
  });

  it("outlines a 512 px tile of 169 nuclei within its CI budget", async () => {
    const discs = [];
    for (let y = 16; y < 512; y += 40) {
      for (let x = 16; x < 512; x += 40) discs.push({ x, y, r: 9 });
    }
    const maps = discMaps(512, 512, discs);
    let fastest = Infinity;
    let found = 0;
    for (let run = 0; run < 9; run++) {
      const started = performance.now();
      found = aisInstances(maps, 512, 512).length;
      fastest = Math.min(fastest, performance.now() - started);
    }
    console.log(`AIS outlines of one 512 px tile: ${fastest.toFixed(1)} ms, ${found} nuclei`);
    assert.equal(found, 169);
    if (process.env.PARFOCAL_PERF === "1") await checkBudget("aiseg.region-outline-ms", fastest);
  });
});
