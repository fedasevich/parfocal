import { expect, test } from "@playwright/test";
import { skipUnlessCached } from "../../golden-images/render/viv-harness.ts";
import { type CycleSlide, runSwitches, summary, writeTrend } from "../browser/memory-run.ts";
import type { HeapBudget } from "../src/memory/heap-trend.ts";

const cycle: readonly CycleSlide[] = [
  { id: "CMU-1.svs", formatId: "aperio-svs" },
  { id: "CMU-1-Small-Region.svs", formatId: "aperio-svs" },
  { id: "CMU-1.tiff", formatId: "generic-tiff" },
  { id: "synthetic-zlib.ome.tiff", formatId: "ome-tiff" },
  { id: "synthetic-jpeg.tiff", formatId: "generic-tiff" },
];

const warmUpVisits = cycle.length;
const slideSwitches = 20;
const longSessionVisits = Number(process.env.MEMORY_LONG_VISITS ?? 100);

const switchBudget: HeapBudget = { maxGrowth: 0.1, maxSlopeBytesPerVisit: null };
const longSessionBudget: HeapBudget = { maxGrowth: 0.1, maxSlopeBytesPerVisit: null };

test.beforeEach(() => {
  skipUnlessCached("CMU-1.svs");
  skipUnlessCached("CMU-1.tiff");
});

test(`${slideSwitches} slide switches with CMU-1.svs keep one Deck and the heap within 10% of baseline`, async ({
  page,
}) => {
  test.setTimeout(900_000);
  const run = await runSwitches(page, {
    release: "wrapper",
    switches: slideSwitches,
    cycle,
    name: "nightly-slide-switches",
    snapshotVisits: new Set([warmUpVisits, warmUpVisits + slideSwitches]),
  });
  console.log(summary(run));
  const trend = writeTrend(`${slideSwitches} slide switches with CMU-1.svs`, run, switchBudget);
  expect(run.samples.map((sample) => sample.report.loadTimeouts)).toEqual(run.samples.map(() => 0));
  expect(run.samples.map((sample) => sample.decks)).toEqual(run.samples.map(() => 1));
  expect(run.samples.map((sample) => sample.canvasContexts)).toEqual(run.samples.map(() => 1));
  expect(trend.check.failures).toEqual([]);
  expect(run.closed).toMatchObject({ decks: 0, devices: 0, canvasContexts: 0, canvases: 0 });
  expect(run.contexts.lost).toBe(run.contexts.created);
});

test(`a long review session of ${longSessionVisits} slide visits keeps one Deck and the heap within 10% of baseline`, async ({
  page,
}) => {
  test.setTimeout(3_600_000);
  const run = await runSwitches(page, {
    release: "wrapper",
    switches: longSessionVisits,
    cycle,
    name: "nightly-long-session",
    snapshotVisits: new Set([warmUpVisits, warmUpVisits + longSessionVisits]),
  });
  console.log(summary(run));
  const trend = writeTrend(
    `long review session of ${longSessionVisits} visits`,
    run,
    longSessionBudget,
  );
  expect(run.samples.map((sample) => sample.report.loadTimeouts)).toEqual(run.samples.map(() => 0));
  expect(run.samples.map((sample) => sample.decks)).toEqual(run.samples.map(() => 1));
  expect(trend.check.failures).toEqual([]);
  expect(run.closed).toMatchObject({ decks: 0, devices: 0, canvasContexts: 0, canvases: 0 });
});
