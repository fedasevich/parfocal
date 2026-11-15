import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CDPSession, Page } from "@playwright/test";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { type HeapBudget, type TrendReport, trendReport } from "../src/memory/heap-trend.ts";
import { collectGarbage, harnessUrl, heapBytes, liveObjects } from "./cdp.ts";
import type { HarnessSlide, MemoryHarness, VisitReport } from "./page/memory-harness.ts";

export const reportDir = fileURLToPath(new URL("../test-results/memory-reports", import.meta.url));

export type CycleSlide = Omit<HarnessSlide, "url">;

export const defaultCycle: readonly CycleSlide[] = [
  { id: "CMU-1-Small-Region.svs", formatId: "aperio-svs" },
  { id: "synthetic-jpeg.tiff", formatId: "generic-tiff" },
  { id: "synthetic-zlib.ome.tiff", formatId: "ome-tiff" },
  { id: "synthetic-big-endian.tiff", formatId: "generic-tiff" },
  { id: "synthetic-sparse.tiff", formatId: "generic-tiff" },
];

const releaseWaitMs = 5_000;

export interface Sample {
  readonly visit: number;
  readonly slide: string;
  readonly heapBytes: number;
  readonly uasmBytes: number | null;
  readonly decks: number;
  readonly devices: number;
  readonly canvasContexts: number;
  readonly report: VisitReport;
}

export interface RunReport {
  readonly release: MemoryHarness["release"];
  readonly viewers: number;
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

export interface RunOptions {
  readonly release: MemoryHarness["release"];
  readonly viewers?: number;
  readonly switches: number;
  readonly cycle?: readonly CycleSlide[];
  readonly snapshotVisits?: ReadonlySet<number>;
  readonly name?: string;
}

function slideAt(cycle: readonly CycleSlide[], visit: number): HarnessSlide {
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

export function envSnapshotVisits(): ReadonlySet<number> {
  return new Set(
    (process.env.MEMORY_SNAPSHOTS ?? "")
      .split(",")
      .filter((visit) => visit !== "")
      .map(Number),
  );
}

export async function writeHeapSnapshot(cdp: CDPSession, name: string): Promise<void> {
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

export async function runSwitches(page: Page, options: RunOptions): Promise<RunReport> {
  const { release, switches } = options;
  const viewers = options.viewers ?? 1;
  const cycle = options.cycle ?? defaultCycle;
  const snapshotVisits = options.snapshotVisits ?? envSnapshotVisits();
  const name = options.name ?? `${release}-${viewers}`;
  const warmUpVisits = cycle.length;
  const started = Date.now();
  await page.setContent("<!doctype html><html><body></body></html>");
  const renderer = await assertSwiftShader(page);
  await page.goto(harnessUrl(`/app/memory.html?release=${release}&viewers=${viewers}`));
  await page.waitForFunction(() => window.memoryHarness !== undefined);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await collectGarbage(cdp);
  const emptyHeapBytes = await heapBytes(cdp);
  const samples: Sample[] = [];
  for (let visit = 0; visit <= warmUpVisits + switches; visit += 1) {
    const shown = Array.from({ length: viewers }, (_, index) => slideAt(cycle, visit + index));
    const slide = { id: shown.map((item) => item.id).join("+") };
    const report = await page.evaluate((next) => window.memoryHarness.visit(next), shown);
    const live = await counts(cdp);
    if (snapshotVisits.has(visit)) await writeHeapSnapshot(cdp, `${name}-visit-${visit}`);
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
  const readContexts = () => page.evaluate(() => ({ ...window.memoryHarness.contexts }));
  let contexts = await readContexts();
  while (contexts.lost < contexts.created && Date.now() - disposedAt < releaseWaitMs) {
    await page.waitForTimeout(25);
    contexts = await readContexts();
  }
  await cdp.detach();
  const run: RunReport = {
    release,
    viewers,
    renderer,
    emptyHeapBytes,
    warmUpVisits,
    samples,
    closed,
    contexts,
    elapsedMs: Date.now() - started,
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.json`), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

export function growth(run: RunReport, from = run.warmUpVisits): number {
  const baseline = run.samples[from];
  const last = run.samples.at(-1);
  if (!baseline || !last) throw new Error("The run has no samples");
  return last.heapBytes / baseline.heapBytes - 1;
}

export function writeTrend(name: string, run: RunReport, budget: HeapBudget): TrendReport {
  const report = trendReport(name, run.samples, run.warmUpVisits, budget);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.trend.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function summary(run: RunReport): string {
  const megabytes = (bytes: number | null) =>
    bytes === null ? "n/a" : (bytes / 2 ** 20).toFixed(1);
  const rows = run.samples.map(
    (sample) =>
      `${sample.visit}\t${sample.slide}\t${megabytes(sample.heapBytes)}\t${megabytes(sample.uasmBytes)}\t${sample.decks}\t${sample.report.openMs.toFixed(0)}\t${sample.report.loadTimeouts}`,
  );
  return [
    `release=${run.release} viewers=${run.viewers} renderer=${run.renderer}`,
    "visit\tslide\theap MB\tUASM MB\tdecks\topen ms\ttimeouts",
    ...rows,
    `closed heap ${megabytes(run.closed.heapBytes)} MB, decks ${run.closed.decksAtDispose} at dispose and ${run.closed.decks} after ${run.closed.releaseMs} ms, canvases ${run.closed.canvases}, growth ${(growth(run) * 100).toFixed(1)}% after warm-up, ${(growth(run, 0) * 100).toFixed(1)}% from the first open`,
  ].join("\n");
}
