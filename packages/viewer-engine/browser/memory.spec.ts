import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { collectGarbage, harnessUrl, heapBytes, liveObjects } from "./cdp.ts";
import type { HarnessSlide, MemoryHarness, VisitReport } from "./page/memory-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/memory-reports", import.meta.url));

const cycle: readonly Omit<HarnessSlide, "url">[] = [
  { id: "CMU-1-Small-Region.svs", formatId: "aperio-svs" },
  { id: "synthetic-jpeg.tiff", formatId: "generic-tiff" },
  { id: "synthetic-zlib.ome.tiff", formatId: "ome-tiff" },
  { id: "synthetic-big-endian.tiff", formatId: "generic-tiff" },
  { id: "synthetic-sparse.tiff", formatId: "generic-tiff" },
];

const warmUpVisits = cycle.length;
const switches = 20;
const heapBudget = 0.1;
const releaseWaitMs = 5_000;

interface Sample {
  readonly visit: number;
  readonly slide: string;
  readonly heapBytes: number;
  readonly uasmBytes: number | null;
  readonly decks: number;
  readonly devices: number;
  readonly canvasContexts: number;
  readonly report: VisitReport;
}

interface RunReport {
  readonly release: MemoryHarness["release"];
  readonly renderer: string;
  readonly emptyHeapBytes: number;
  readonly warmUpVisits: number;
  readonly samples: readonly Sample[];
  readonly closed: {
    readonly heapBytes: number;
    readonly uasmBytes: number | null;
    readonly decks: number;
    readonly devices: number;
    readonly canvasContexts: number;
    readonly canvases: number;
    readonly decksAtDispose: number;
    readonly releaseMs: number;
  };
  readonly contexts: { readonly created: number; readonly lost: number };
  readonly elapsedMs: number;
}

function slideAt(visit: number): HarnessSlide {
  const entry = cycle[visit % cycle.length];
  if (!entry) throw new Error(`No slide for visit ${visit}`);
  const folder = entry.id.startsWith("synthetic-") ? "/synthetic" : "/cache";
  return { ...entry, url: harnessUrl(`${folder}/${entry.id}`) };
}

async function uasmBytes(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const measure = (
      performance as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }
    ).measureUserAgentSpecificMemory;
    if (!crossOriginIsolated || !measure) return null;
    return (await measure.call(performance)).bytes;
  });
}

async function counts(cdp: CDPSession) {
  await collectGarbage(cdp);
  return {
    decks: await liveObjects(cdp, "window.memoryHarness.prototypes.deck"),
    devices: await liveObjects(cdp, "window.memoryHarness.prototypes.device"),
    canvasContexts: await liveObjects(cdp, "window.memoryHarness.prototypes.canvasContext"),
  };
}

const snapshotVisits = new Set(
  (process.env.MEMORY_SNAPSHOTS ?? "")
    .split(",")
    .filter((visit) => visit !== "")
    .map(Number),
);

async function writeHeapSnapshot(cdp: CDPSession, name: string): Promise<void> {
  const chunks: string[] = [];
  const collect = ({ chunk }: { chunk: string }) => {
    chunks.push(chunk);
  };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", collect);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", collect);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.heapsnapshot`), chunks.join(""));
}

async function runSwitches(page: Page, release: MemoryHarness["release"]): Promise<RunReport> {
  const started = Date.now();
  await page.setContent("<!doctype html><html><body></body></html>");
  const renderer = await assertSwiftShader(page);
  await page.goto(harnessUrl(`/app/memory.html?release=${release}`));
  await page.waitForFunction(() => window.memoryHarness !== undefined);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await collectGarbage(cdp);
  const emptyHeapBytes = await heapBytes(cdp);
  const samples: Sample[] = [];
  for (let visit = 0; visit <= warmUpVisits + switches; visit += 1) {
    const slide = slideAt(visit);
    const report = await page.evaluate((next) => window.memoryHarness.visit(next), slide);
    const live = await counts(cdp);
    if (snapshotVisits.has(visit)) await writeHeapSnapshot(cdp, `${release}-visit-${visit}`);
    samples.push({
      visit,
      slide: slide.id,
      heapBytes: await heapBytes(cdp),
      uasmBytes: await uasmBytes(page),
      ...live,
      report,
    });
  }
  const canvases = await page.evaluate(() => window.memoryHarness.dispose());
  const disposedAt = Date.now();
  const decksAtDispose = (await counts(cdp)).decks;
  let live = await counts(cdp);
  while (live.decks > 0 && Date.now() - disposedAt < releaseWaitMs) {
    await page.waitForTimeout(25);
    live = await counts(cdp);
  }
  const releaseMs = Date.now() - disposedAt;
  const closed = {
    heapBytes: await heapBytes(cdp),
    uasmBytes: await uasmBytes(page),
    ...live,
    canvases,
    decksAtDispose,
    releaseMs,
  };
  const contexts = await page.evaluate(() => ({ ...window.memoryHarness.contexts }));
  await cdp.detach();
  const run: RunReport = {
    release,
    renderer,
    emptyHeapBytes,
    warmUpVisits,
    samples,
    closed,
    contexts,
    elapsedMs: Date.now() - started,
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${release}.json`), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

function growth(run: RunReport, from = run.warmUpVisits): number {
  const baseline = run.samples[from];
  const last = run.samples.at(-1);
  if (!baseline || !last) throw new Error("The run has no samples");
  return last.heapBytes / baseline.heapBytes - 1;
}

function summary(run: RunReport): string {
  const megabytes = (bytes: number | null) =>
    bytes === null ? "n/a" : (bytes / 2 ** 20).toFixed(1);
  const rows = run.samples.map(
    (sample) =>
      `${sample.visit}\t${sample.slide}\t${megabytes(sample.heapBytes)}\t${megabytes(sample.uasmBytes)}\t${sample.decks}\t${sample.report.openMs.toFixed(0)}\t${sample.report.loadTimeouts}`,
  );
  return [
    `release=${run.release} renderer=${run.renderer}`,
    "visit\tslide\theap MB\tUASM MB\tdecks\topen ms\ttimeouts",
    ...rows,
    `closed heap ${megabytes(run.closed.heapBytes)} MB, decks ${run.closed.decksAtDispose} at dispose and ${run.closed.decks} after ${run.closed.releaseMs} ms, canvases ${run.closed.canvases}, growth ${(growth(run) * 100).toFixed(1)}% after warm-up, ${(growth(run, 0) * 100).toFixed(1)}% from the first open`,
  ].join("\n");
}

test("20 slide switches after a warm-up pass keep one Deck and the heap within 10% of baseline", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const run = await runSwitches(page, "wrapper");
  console.log(summary(run));
  expect(run.samples.map((sample) => sample.report.loadTimeouts)).toEqual(run.samples.map(() => 0));
  expect(run.samples.map((sample) => sample.decks)).toEqual(run.samples.map(() => 1));
  expect(run.samples.map((sample) => sample.canvasContexts)).toEqual(run.samples.map(() => 1));
  expect(run.samples.map((sample) => sample.report.canvases)).toEqual(run.samples.map(() => 1));
  expect(growth(run)).toBeLessThanOrEqual(heapBudget);
  expect(run.closed).toMatchObject({ decks: 0, devices: 0, canvasContexts: 0, canvases: 0 });
  expect(run.contexts.lost).toBe(run.contexts.created);
});

test("without canvasContext.destroy every old Deck stays alive, so the wrapper is still needed", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const run = await runSwitches(page, "no-canvas-context");
  console.log(summary(run));
  const last = run.samples.at(-1);
  expect(
    last?.decks,
    "deck.gl or luma.gl now releases finalized decks without canvasContext.destroy(). Rerun the STACK-015 test and drop the wrapper as ADR 0098 says",
  ).toBe(warmUpVisits + switches + 1);
  expect(growth(run)).toBeGreaterThan(heapBudget);
});
