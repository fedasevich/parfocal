import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkHeapTrend,
  heapTrend,
  isTrendReport,
  leastSquaresSlope,
  trendMarkdown,
  trendReport,
} from "../../src/memory/heap-trend.ts";

const mb = 2 ** 20;
const points = (heaps: readonly number[]) =>
  heaps.map((heapBytes, visit) => ({ visit, heapBytes }));

test("the least squares slope of a straight line is its gradient", () => {
  assert.equal(
    leastSquaresSlope([
      { x: 0, y: 3 },
      { x: 1, y: 5 },
      { x: 2, y: 7 },
    ]),
    2,
  );
  assert.equal(leastSquaresSlope([{ x: 4, y: 9 }]), 0);
  assert.equal(
    leastSquaresSlope([
      { x: 1, y: 1 },
      { x: 1, y: 5 },
    ]),
    0,
  );
});

test("growth is measured from the first sample after warm-up and the slope ignores warm-up", () => {
  const trend = heapTrend(points([10 * mb, 40 * mb, 50 * mb, 52 * mb, 51 * mb, 55 * mb]), 2);
  assert.equal(trend.baselineBytes, 50 * mb);
  assert.equal(trend.lastBytes, 55 * mb);
  assert.equal(trend.peakBytes, 55 * mb);
  assert.ok(Math.abs(trend.growth - 0.1) < 1e-12);
  assert.ok(Math.abs(trend.growthFromFirst - 4.5) < 1e-12);
  assert.ok(Math.abs(trend.slopeBytesPerVisit - 1.4 * mb) < 1);
});

test("a trend without samples after warm-up is refused", () => {
  assert.throws(() => heapTrend(points([mb, mb]), 2), /more than 2 samples/);
});

test("a heap within its growth budget passes and one over it fails with the numbers", () => {
  const flat = heapTrend(points([50 * mb, 50 * mb, 51 * mb]), 0);
  assert.deepEqual(checkHeapTrend(flat, { maxGrowth: 0.1, maxSlopeBytesPerVisit: null }), {
    pass: true,
    reportOnly: false,
    failures: [],
  });
  const leaking = heapTrend(points([50 * mb, 60 * mb, 70 * mb]), 0);
  const check = checkHeapTrend(leaking, { maxGrowth: 0.1, maxSlopeBytesPerVisit: 1024 });
  assert.equal(check.pass, false);
  assert.deepEqual(check.failures, [
    "heap grew 40.0% after warm-up, over the 10.0% budget",
    "heap climbs 10240.0 KB a visit, over the 1.0 KB budget",
  ]);
});

test("a run with no budget yet is report only and always passes", () => {
  const leaking = heapTrend(points([50 * mb, 90 * mb]), 0);
  assert.deepEqual(checkHeapTrend(leaking, { maxGrowth: null, maxSlopeBytesPerVisit: null }), {
    pass: true,
    reportOnly: true,
    failures: [],
  });
});

test("the markdown summary has one row per run, TODO for a missing budget and the failures below", () => {
  const passing = trendReport("slides", points([50 * mb, 51 * mb]), 0, {
    maxGrowth: 0.1,
    maxSlopeBytesPerVisit: null,
  });
  const pending = trendReport("workspaces", points([20 * mb, 22 * mb]), 0, {
    maxGrowth: null,
    maxSlopeBytesPerVisit: null,
  });
  const failing = trendReport("long session", points([50 * mb, 70 * mb]), 0, {
    maxGrowth: 0.1,
    maxSlopeBytesPerVisit: null,
  });
  const markdown = trendMarkdown([passing, pending, failing]);
  const lines = markdown.split("\n");
  assert.equal(lines[0], "## Memory and leak suite");
  assert.equal(
    lines[4],
    "| slides | 2 | 50.0 MB | 51.0 MB | 51.0 MB | 2.0% | 10.0% | 1024.0 KB | pass |",
  );
  assert.equal(
    lines[5],
    "| workspaces | 2 | 20.0 MB | 22.0 MB | 22.0 MB | 10.0% | TODO | 2048.0 KB | report only |",
  );
  assert.ok(lines[6]?.endsWith("| fail |"));
  assert.ok(
    markdown.includes("- long session: heap grew 40.0% after warm-up, over the 10.0% budget"),
  );
});

test("only parsed trend reports are recognised", () => {
  const report = trendReport("slides", points([mb, mb]), 0, {
    maxGrowth: 0.1,
    maxSlopeBytesPerVisit: null,
  });
  assert.equal(isTrendReport(JSON.parse(JSON.stringify(report))), true);
  assert.equal(isTrendReport({ release: "wrapper", samples: [] }), false);
  assert.equal(isTrendReport(null), false);
});
