import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { type SyntheticSlide, syntheticSlide } from "../test/nuclei/synthetic.ts";
import { collectGarbage, harnessUrl, heapBytes } from "./cdp.ts";
import type { PagingReport } from "./page/nuclei-paging-harness.ts";

const cells = 1_607_244;
const classes = 5;
const repetitions = 3;
const usableLimitMs = 4000;
const heapLimitBytes = 100 * 1024 * 1024;
const view = { width: 5760, height: 3840 };
const sweepViews = 41;
const lookupNumber = 800_000;
const reportDir = fileURLToPath(new URL("../test-results/nuclei-paging", import.meta.url));

interface Measured {
  readonly report: PagingReport;
  readonly jsHeapBytes: number;
  readonly heldBytes: number;
  readonly uasmBytes: number | null;
  readonly summaryBytes: number;
  readonly chunkRequests: number;
  readonly chunkBytes: number;
}

let slide: SyntheticSlide | null = null;
let chunks: Uint8Array<ArrayBuffer>[] = [];
let server: Server | null = null;
let origin = "";
let served = { summary: 0, chunkRequests: 0, chunkBytes: 0 };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async () => {
  slide = syntheticSlide({ cells, classes, verticesPerCell: 19 });
  chunks = Array.from(
    { length: slide.chunks },
    (_, index) => slide?.chunk(index) ?? new Uint8Array(),
  );
  const headers = {
    "content-type": "application/octet-stream",
    "content-encoding": "gzip",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  };
  server = createServer((request, response) => {
    const path = request.url ?? "";
    if (path === "/summary" && slide) {
      served.summary = slide.summary.length;
      response.writeHead(200, headers);
      response.end(slide.summary);
      return;
    }
    const match = /^\/chunk\/(\d+)$/.exec(path);
    const body = match ? chunks[Number(match[1])] : undefined;
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    served.chunkRequests++;
    served.chunkBytes += body.length;
    response.writeHead(200, headers);
    response.end(body);
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

async function uasmBytes(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const measure = (
      performance as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }
    ).measureUserAgentSpecificMemory;
    if (!crossOriginIsolated || !measure) return null;
    return (await measure.call(performance)).bytes;
  });
}

async function measureOnce(page: Page): Promise<Measured> {
  if (!slide) throw new Error("No slide");
  served = { summary: 0, chunkRequests: 0, chunkBytes: 0 };
  await page.goto(harnessUrl("/app/nuclei-paging.html"));
  await page.waitForFunction(() => window.pagingHarness !== undefined);
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const report = await page.evaluate((config) => window.pagingHarness.run(config), {
    origin,
    slideWidth: slide.width,
    slideHeight: slide.height,
    viewWidth: view.width,
    viewHeight: view.height,
    sweepViews,
    lookupNumber,
  });
  await collectGarbage(cdp);
  const measured: Measured = {
    report,
    jsHeapBytes: await heapBytes(cdp),
    heldBytes: await page.evaluate(() => window.pagingHarness.heldBytes()),
    uasmBytes: await uasmBytes(page),
    summaryBytes: served.summary,
    chunkRequests: served.chunkRequests,
    chunkBytes: served.chunkBytes,
  };
  await cdp.detach();
  return measured;
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

test("the 1.6 million nucleus set is usable in under 4 s at under 100 MB", async ({ browser }) => {
  const runs: Measured[] = [];
  for (let run = 0; run < repetitions; run++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    runs.push(await measureOnce(page));
    await context.close();
  }
  const usable = Math.min(...runs.map((run) => run.report.usableMs));
  const memory = Math.max(...runs.map((run) => run.uasmBytes ?? run.jsHeapBytes + run.heldBytes));
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, "report.json"),
    JSON.stringify({ cells, chunks: slide?.chunks, usable, memory, runs }, null, 2),
  );
  console.log(
    runs
      .map(
        (run) =>
          `usable ${run.report.usableMs.toFixed(0)} ms, open ${run.report.openMs.toFixed(0)} ms, js heap ${megabytes(run.jsHeapBytes)} MB, held ${megabytes(run.heldBytes)} MB, uasm ${run.uasmBytes === null ? "n/a" : megabytes(run.uasmBytes)} MB, sweep p95 ${run.report.sweepP95Ms.toFixed(0)} ms`,
      )
      .join("\n"),
  );

  for (const run of runs) {
    expect(run.report.paged).toBe(true);
    expect(run.report.editsSurvivedEviction).toBe(true);
    expect(run.report.afterSweep.cells).toBe(cells);
    expect(run.report.mostResidentVertices).toBeLessThan(run.report.vertexBudget * 1.5);
  }
  expect(usable).toBeLessThan(usableLimitMs);
  expect(memory).toBeLessThan(heapLimitBytes);
  await checkBudget("nuclei.paging-open-ms", usable, { rttMs: 0 });
  await checkBudget("nuclei.paging-memory-bytes", memory);
});
