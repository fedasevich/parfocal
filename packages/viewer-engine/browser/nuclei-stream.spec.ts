import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type SyntheticSlide, syntheticSlide } from "../test/nuclei/synthetic.ts";
import { harnessUrl } from "./cdp.ts";
import { summarizeMainThread, traceCategories } from "./main-thread-trace.ts";
import type { StreamState } from "./page/nuclei-stream-harness.ts";

const frameLimitMs = 33;
const reportDir = fileURLToPath(new URL("../test-results/nuclei-stream", import.meta.url));

interface SimulatedRun {
  readonly slide: SyntheticSlide;
  readonly chunks: readonly Uint8Array<ArrayBuffer>[];
  readonly tileMs: number;
  startedAt: number | null;
  cancelledAt: number | null;
  cancelPolls: number;
}

let run: SimulatedRun | null = null;
let server: Server | null = null;
let origin = "";

const headers = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
};

function finishedBy(current: SimulatedRun, at: number): number {
  if (current.startedAt === null) return 0;
  const until = current.cancelledAt === null ? at : Math.min(at, current.cancelledAt);
  return Math.min(current.slide.chunks, Math.floor((until - current.startedAt) / current.tileMs));
}

function statusOf(current: SimulatedRun, finished: number): string {
  if (current.cancelledAt !== null) {
    current.cancelPolls++;
    return current.cancelPolls > 1 ? "cancelled" : "cancelling";
  }
  return finished === current.slide.chunks ? "done" : "running";
}

function areasBody(current: SimulatedRun, after: number): string {
  const now = Date.now();
  current.startedAt ??= now;
  const finished = finishedBy(current, now);
  const status = statusOf(current, finished);
  const started = current.startedAt;
  const areas = current.slide.tiles.slice(after, finished).map((tile, offset) => {
    const unit = after + offset;
    return {
      seq: unit + 1,
      stage: "detect",
      unit,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      objects: tile.count,
      done_at: new Date(started + (unit + 1) * current.tileMs).toISOString(),
    };
  });
  return JSON.stringify({
    run_id: "run-1",
    status,
    areas,
    after: Math.max(after, finished),
    more: false,
    total: current.slide.chunks,
  });
}

function cellsFinished(current: SimulatedRun): number {
  const finished = finishedBy(current, Date.now());
  return current.slide.tiles.slice(0, finished).reduce((sum, tile) => sum + tile.count, 0);
}

function simulate(cells: number, grid: number, tileMs: number): SimulatedRun {
  const slide = syntheticSlide({ cells, classes: 5, verticesPerCell: 19, grid, withProbs: false });
  return {
    slide,
    chunks: Array.from({ length: slide.chunks }, (_, index) => slide.chunk(index)),
    tileMs,
    startedAt: null,
    cancelledAt: null,
    cancelPolls: 0,
  };
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const current = run;
    if (current === null) {
      response.writeHead(404, headers).end();
      return;
    }
    if (url.pathname === "/areas") {
      response.writeHead(200, { ...headers, "content-type": "application/json" });
      response.end(areasBody(current, Number(url.searchParams.get("after") ?? 0)));
      return;
    }
    if (url.pathname === "/cancel" && request.method === "POST") {
      current.cancelledAt ??= Date.now();
      response.writeHead(204, headers).end();
      return;
    }
    const match = /^\/tile\/(\d+)$/.exec(url.pathname);
    const body = match ? current.chunks[Number(match[1])] : undefined;
    if (!body) {
      response.writeHead(404, headers).end();
      return;
    }
    response.writeHead(200, {
      ...headers,
      "content-type": "application/octet-stream",
      "content-encoding": "gzip",
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

async function openHarness(
  page: Page,
  current: SimulatedRun,
  pollMs: number,
  beforeStart: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await page.goto(
    harnessUrl(`/app/nuclei-stream.html${process.env["STREAM_WARM"] ? "?warm" : ""}`),
  );
  await page.waitForFunction(() => window.streamHarness !== undefined);
  const config = {
    origin,
    lineage: "run-1",
    slideWidth: current.slide.width,
    slideHeight: current.slide.height,
    pollMs,
  };
  await page.evaluate((next) => window.streamHarness.prepare(next), config);
  await page.waitForTimeout(500);
  await beforeStart();
  await page.evaluate((next) => window.streamHarness.start(next), config);
}

function report(name: string, state: StreamState): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.json`), JSON.stringify(state, null, 2));
}

test("a run's objects appear before it ends, and cancel keeps them", async ({ page }) => {
  const current = simulate(20_000, 1024, 400);
  run = current;
  await openHarness(page, current, 200);

  await page.waitForFunction(() => {
    const state = window.streamHarness.state();
    return state.drawn > 0 && state.progress?.status === "running";
  });
  const before = await page.evaluate(() => window.streamHarness.state());
  expect(before.progress?.done ?? 0).toBeLessThan(current.slide.chunks);

  await page.evaluate(() => window.streamHarness.cancel());
  const ended = await page.evaluate(() => window.streamHarness.finished());
  report("cancel", ended);

  const kept = cellsFinished(current);
  expect(ended.error).toBeNull();
  expect(ended.progress?.status).toBe("cancelled");
  expect(ended.progress?.done ?? 0).toBeLessThan(current.slide.chunks);
  expect(kept).toBeGreaterThan(0);
  expect(ended.drawn).toBe(kept);
  expect(ended.progress?.objects).toBe(kept);
  expect(ended.marks).toBe(ended.progress?.done);

  await page.waitForTimeout(1000);
  const later = await page.evaluate(() => window.streamHarness.state());
  expect(later.drawn).toBe(kept);
});

test("streaming 250,000 nuclei never holds a frame over 33 ms", async ({ page, browser }) => {
  const current = simulate(250_000, 2048, 120);
  run = current;
  await openHarness(page, current, 250, () =>
    browser.startTracing(undefined, { categories: [...traceCategories] }),
  );
  const ended = await page.evaluate(() => window.streamHarness.finished());
  const trace = summarizeMainThread(await browser.stopTracing());
  report("perf", ended);
  console.log(
    JSON.stringify(trace.longest),
    `longest draw ${ended.longestDrawMs.toFixed(1)} ms, layer build ${ended.longestBuildMs.toFixed(1)} ms`,
    `longest gap ends ${(ended.longestFrameAt - (ended.rebuilds[0]?.at ?? 0)).toFixed(0)} ms after the first draw`,
  );
  console.log(
    `longest main-thread task ${trace.longestPageMs.toFixed(1)} ms, frames ${ended.frames}, longest frame gap ${ended.longestFrameMs.toFixed(1)} ms, gaps over ${frameLimitMs} ms ${ended.framesOver}, passes ${ended.progress?.rebuilds}`,
  );

  expect(ended.error).toBeNull();
  expect(ended.progress?.status).toBe("done");
  expect(ended.drawn).toBe(250_000);
  const passStarts = new Map<number, number>();
  for (const entry of ended.rebuilds) {
    if (!passStarts.has(entry.pass)) passStarts.set(entry.pass, entry.at);
  }
  const starts = [...passStarts.values()].slice(0, -1);
  expect(starts.length).toBeGreaterThanOrEqual(2);
  for (let index = 1; index < starts.length; index++) {
    expect((starts[index] ?? 0) - (starts[index - 1] ?? 0)).toBeGreaterThanOrEqual(2999);
  }
  expect(ended.frames).toBeGreaterThan(100);
  expect(trace.longestPageMs).toBeLessThan(frameLimitMs);
});
