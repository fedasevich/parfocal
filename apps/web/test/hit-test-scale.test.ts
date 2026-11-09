import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { buildBoundsIndex } from "../src/annotations/spatial-index.ts";

const nucleusCount = 1_000_000;
const slideSide = 20_000;
const hoverPoints = 20_000;
const tolerance = 2;
const groupCount = 8;
const hiddenGroup = 3;
const lockedGroup = 5;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function percentile(sorted: Float64Array, fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

describe("hit testing at scale", () => {
  test("hover hit tests over 1M nuclei stay under 1 ms (annotate.hit-test-1m-ms)", async () => {
    const random = seeded(7);
    const bounds = new Float32Array(nucleusCount * 4);
    const groupOf = new Uint8Array(nucleusCount);
    const active = new Uint8Array(nucleusCount);
    for (let i = 0; i < nucleusCount; i++) {
      const cx = random() * slideSide;
      const cy = random() * slideSide;
      const radius = 3 + random() * 4;
      bounds[i * 4] = cx - radius;
      bounds[i * 4 + 1] = cy - radius;
      bounds[i * 4 + 2] = cx + radius;
      bounds[i * 4 + 3] = cy + radius;
      const group = i % groupCount;
      groupOf[i] = group;
      active[i] = group === hiddenGroup || group === lockedGroup ? 0 : 1;
    }

    const buildStart = performance.now();
    const index = buildBoundsIndex(bounds, active);
    const buildMs = performance.now() - buildStart;

    const pick = (x: number, y: number): number => {
      let best = -1;
      index.query(x - tolerance, y - tolerance, x + tolerance, y + tolerance, (item) => {
        const o = item * 4;
        const rx = ((bounds[o + 2] ?? 0) - (bounds[o] ?? 0)) / 2;
        const ry = ((bounds[o + 3] ?? 0) - (bounds[o + 1] ?? 0)) / 2;
        const dx = (x - ((bounds[o] ?? 0) + rx)) / (rx + tolerance);
        const dy = (y - ((bounds[o + 1] ?? 0) + ry)) / (ry + tolerance);
        if (dx * dx + dy * dy <= 1 && item > best) best = item;
      });
      return best;
    };

    const xs = new Float64Array(hoverPoints);
    const ys = new Float64Array(hoverPoints);
    for (let k = 0; k < hoverPoints; k++) {
      xs[k] = random() * slideSide;
      ys[k] = random() * slideSide;
    }

    for (let k = 0; k < 2_000; k++) pick(xs[k] ?? 0, ys[k] ?? 0);

    let hits = 0;
    let bestMedian = Number.POSITIVE_INFINITY;
    let bestP95 = Number.POSITIVE_INFINITY;
    let bestMax = Number.POSITIVE_INFINITY;
    for (let pass = 0; pass < 3; pass++) {
      const times = new Float64Array(hoverPoints);
      hits = 0;
      for (let k = 0; k < hoverPoints; k++) {
        const start = performance.now();
        const found = pick(xs[k] ?? 0, ys[k] ?? 0);
        times[k] = performance.now() - start;
        if (found >= 0) {
          hits++;
          const group = groupOf[found] ?? 0;
          assert.notEqual(group, hiddenGroup);
          assert.notEqual(group, lockedGroup);
        }
      }
      times.sort();
      bestMedian = Math.min(bestMedian, percentile(times, 0.5));
      bestP95 = Math.min(bestP95, percentile(times, 0.95));
      bestMax = Math.min(bestMax, times[times.length - 1] ?? 0);
    }

    console.log(
      `hit-test-1m build ${buildMs.toFixed(0)} ms, hover median ${bestMedian.toFixed(5)} ms, p95 ${bestP95.toFixed(5)} ms, max ${bestMax.toFixed(3)} ms, hits ${hits} of ${hoverPoints}`,
    );
    assert.ok(hits > 0);
    assert.ok(bestMedian < 1, `median ${bestMedian} ms`);
    assert.ok(bestP95 < 1, `p95 ${bestP95} ms`);
    await checkBudget("annotate.hit-test-1m-ms", bestP95, { rttMs: 0 });
  });
});
