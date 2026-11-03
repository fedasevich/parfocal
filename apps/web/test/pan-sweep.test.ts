import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DebugCamera,
  type DebugHandleHost,
  installDebugHandle,
  provideDebug,
} from "../src/debug-handle.ts";
import {
  type BenchmarkRow,
  benchmarkColumns,
  benchmarkCsv,
  benchmarkDebug,
  benchmarkFileName,
  createBenchmarkLog,
  NoSlideOpen,
  percentile,
  runPanSweep,
  type SweepClock,
  settleMs,
  sweepPath,
  sweepSteps,
} from "../src/lab/pan-sweep.ts";
import { csvColumns } from "../src/screens/developer/developer-data.ts";

function fakeClock(frameMs: (index: number) => number) {
  let now = 0;
  let index = 0;
  const waits: number[] = [];
  const clock: SweepClock = {
    frame: () => {
      now += frameMs(index);
      index += 1;
      return Promise.resolve(now);
    },
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
  return { clock, waits };
}

function fakeViewer(start: DebugCamera, stats: Record<string, unknown> = {}) {
  let camera = start;
  const seen: DebugCamera[] = [];
  return {
    seen,
    handle: {
      getCamera: () => camera,
      setCamera: (next: DebugCamera) => {
        camera = next;
        seen.push(next);
      },
      getRoute: () => "viv",
      getStats: () => stats,
    },
    camera: () => camera,
  };
}

test("the drawer lists the 16 CSV columns the export writes", () => {
  assert.equal(benchmarkColumns.length, 16);
  assert.deepEqual([...csvColumns], [...benchmarkColumns]);
  assert.equal(benchmarkCsv([]), `${benchmarkColumns.join(",")}\n`);
});

test("the sweep is a closed 180 step ellipse at the asked zoom that starts and ends at the view", () => {
  const center = { x: 5000, y: 3000, scale: 0.5 };
  const path = sweepPath(center, 2);
  assert.equal(path.length, sweepSteps);
  assert.equal(sweepSteps, 180);
  assert.ok(path.every((camera) => camera.scale === 2));
  const end = path.at(-1);
  assert.ok(end !== undefined);
  assert.ok(Math.abs(end.x - center.x) < 1e-9 && Math.abs(end.y - center.y) < 1e-9);
  const xs = path.map((camera) => camera.x);
  const ys = path.map((camera) => camera.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys));
});

test("percentiles use the nearest rank", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([4, 1, 3, 2], 50), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([7], 95), 7);
});

test("a sweep pans every step, settles, puts the camera back and reports frame times", async () => {
  const start = { x: 100, y: 200, scale: 1 };
  const viewer = fakeViewer(start, {
    nuclei: 100000,
    tilesResident: 412,
    cullMode: "gpu",
    drawn: "x",
  });
  const { clock, waits } = fakeClock((index) => (index % 10 === 9 ? 20 : 10));
  const row = await runPanSweep(viewer.handle, 2, clock);
  assert.equal(viewer.seen.length, sweepSteps + 1);
  assert.deepEqual(viewer.camera(), start);
  assert.deepEqual(waits, [settleMs]);
  assert.equal(row.renderer, "viv");
  assert.equal(row.zoom, 2);
  assert.equal(row.frameP50, 10);
  assert.equal(row.frameP95, 20);
  assert.equal(row.fps, 90.9);
  assert.equal(row.nuclei, 100000);
  assert.equal(row.tilesResident, 412);
  assert.equal(row.cullMode, "gpu");
  assert.equal(row.drawn, "x");
  assert.equal(row.gpuBytes, null);
  assert.deepEqual(Object.keys(row).sort(), [...benchmarkColumns].sort());
});

test("a sweep without an open slide refuses and moves nothing", async () => {
  const { clock } = fakeClock(() => 16);
  await assert.rejects(runPanSweep(undefined, 2, clock), NoSlideOpen);
  await assert.rejects(runPanSweep({ getCamera: () => null }, 2, clock), NoSlideOpen);
  const viewer = fakeViewer({ x: 0, y: 0, scale: 1 });
  await assert.rejects(runPanSweep(viewer.handle, 0, clock), NoSlideOpen);
  assert.equal(viewer.seen.length, 0);
});

test("the camera goes back even when a frame fails", async () => {
  const start = { x: 1, y: 2, scale: 3 };
  const viewer = fakeViewer(start);
  let calls = 0;
  const clock: SweepClock = {
    frame: () => {
      calls += 1;
      if (calls > 5) return Promise.reject(new Error("lost context"));
      return Promise.resolve(calls * 16);
    },
    wait: () => Promise.resolve(),
  };
  await assert.rejects(runPanSweep(viewer.handle, 2, clock));
  assert.deepEqual(viewer.camera(), start);
});

test("the CSV writes one row per run in column order and quotes awkward text", () => {
  const row = Object.fromEntries(benchmarkColumns.map((column) => [column, null])) as BenchmarkRow;
  const csv = benchmarkCsv([
    { ...row, renderer: "deck webgl2", nuclei: 1000000, zoom: 2, frameP50: 6.2 },
    { ...row, renderer: 'odd, "name"' },
  ]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], `deck webgl2,1000000,2,,6.2${",".repeat(11)}`);
  assert.equal(lines[1]?.split(",").length, 16);
  assert.ok(lines[2]?.startsWith('"odd, ""name""",'));
  assert.equal(
    benchmarkFileName(new Date("2026-11-03T12:00:00Z")),
    "parfocal-pan-sweep-2026-11-03.csv",
  );
});

test("the debug handle runs the sweep, counts rows and returns the CSV", async () => {
  const host: DebugHandleHost = {};
  installDebugHandle(host, "dev");
  const log = createBenchmarkLog();
  const { clock } = fakeClock(() => 16);
  provideDebug(benchmarkDebug(host, log, clock), host);
  provideDebug(fakeViewer({ x: 0, y: 0, scale: 1 }).handle, host);
  let changes = 0;
  log.subscribe(() => {
    changes += 1;
  });
  assert.equal(host.__parfocal?.getSampleCount?.(), 0);
  await host.__parfocal?.runBenchmark?.(4);
  await host.__parfocal?.runBenchmark?.(1);
  assert.equal(host.__parfocal?.getSampleCount?.(), 2);
  assert.equal(changes, 2);
  const lines = host.__parfocal?.csv?.().trimEnd().split("\n") ?? [];
  assert.equal(lines.length, 3);
  assert.ok(lines[1]?.startsWith("viv,,4,,16,16,,62.5,"));
});
