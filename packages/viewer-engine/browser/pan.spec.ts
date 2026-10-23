import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@parfocal/test-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { type LatencyProxy, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import { type Served, type ServedRequest, serve } from "../test/pixel-source/serve.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import type { PanLeg, PanReport, PanSlide } from "./page/pan-harness.ts";

const slideFile = "CMU-1.svs";
const slidePath = `/cache/${slideFile}`;
const rttMs = Number(process.env.PAN_RTT_MS ?? 100);
const bandwidthBytesPerSecond =
  process.env.PAN_BANDWIDTH === undefined ? null : Number(process.env.PAN_BANDWIDTH);
const magnification = 10;
const settleTimeoutMs = 90_000;
const outbound: readonly PanLeg[] = [{ dx: 40, dy: 0, frames: 90 }];
const back: readonly PanLeg[] = [{ dx: -40, dy: 0, frames: 90 }];
const reportDir = fileURLToPath(new URL("../test-results/pan-reports", import.meta.url));

const availability = fixtureAvailability(slideFile);

test.describe.configure({ mode: "serial", timeout: 240_000 });

let served: Served | null = null;
let proxy: LatencyProxy | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  if (availability.status !== "ready") return;
  served = await serve(
    { "/app": outDir, "/cache": fixturesDir() },
    { headers: crossOriginIsolated },
  );
  proxy = await startLatencyProxy({ target: served.origin, rttMs, bandwidthBytesPerSecond });
});

test.afterAll(async () => {
  await proxy?.close();
  await served?.close();
  proxy = null;
  served = null;
});

interface Traffic {
  readonly fetches: number;
  readonly bytes: number;
  readonly uniqueBytes: number;
  readonly duplicateBytes: number;
}

function rangeOf(entry: ServedRequest): readonly [number, number] {
  const match = /^bytes=(\d+)-(\d+)$/.exec(entry.range ?? "");
  if (match === null) throw new Error(`The slide was fetched without a byte range: ${entry.range}`);
  return [Number(match[1]), Number(match[1]) + entry.bytes - 1];
}

function traffic(entries: readonly ServedRequest[]): Traffic {
  const ranges = entries.map(rangeOf).sort((a, b) => a[0] - b[0]);
  let uniqueBytes = 0;
  let reached = -1;
  for (const [start, end] of ranges) {
    if (end > reached) {
      uniqueBytes += end - Math.max(start, reached + 1) + 1;
      reached = end;
    }
  }
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return { fetches: entries.length, bytes, uniqueBytes, duplicateBytes: bytes - uniqueBytes };
}

type Setup = Pick<PanSlide, "workers" | "reader">;

interface Run {
  readonly setup: Setup;
  readonly rttMs: number;
  readonly bandwidthBytesPerSecond: number | null;
  readonly open: Traffic;
  readonly outbound: Traffic;
  readonly back: Traffic;
  readonly total: Traffic;
  readonly outboundReport: PanReport;
  readonly backReport: PanReport;
}

function slideRequests(from: number, to?: number): ServedRequest[] {
  if (served === null) throw new Error("The slide server is not running");
  return served.log.slice(from, to).filter((entry) => entry.path === slidePath);
}

async function panRun(page: Page, setup: Setup): Promise<Run> {
  if (served === null || proxy === null) throw new Error("The slide server is not running");
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertSwiftShader(page);
  await page.goto(`${proxy.url}/app/pan.html`);
  await page.waitForFunction(() => window.panHarness !== undefined);
  const start = served.log.length;
  const slide: PanSlide = {
    url: `${proxy.url}${slidePath}`,
    formatId: "aperio-svs",
    ...setup,
    magnification,
    ...cmu1TissueCentre,
  };
  await page.evaluate((next) => window.panHarness.open(next), slide);
  const opened = served.log.length;
  const outboundReport = await page.evaluate(
    ({ legs, timeout }) => window.panHarness.pan(legs, timeout),
    { legs: outbound, timeout: settleTimeoutMs },
  );
  const turned = served.log.length;
  const backReport = await page.evaluate(
    ({ legs, timeout }) => window.panHarness.pan(legs, timeout),
    { legs: back, timeout: settleTimeoutMs },
  );
  await page.evaluate(() => window.panHarness.close());
  return {
    setup,
    rttMs,
    bandwidthBytesPerSecond,
    open: traffic(slideRequests(start, opened)),
    outbound: traffic(slideRequests(opened, turned)),
    back: traffic(slideRequests(turned)),
    total: traffic(slideRequests(start)),
    outboundReport,
    backReport,
  };
}

function save(name: string, run: Run): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.json`), `${JSON.stringify(run, null, 2)}\n`);
  console.log(
    `${name}: open ${run.open.fetches} fetches ${run.open.bytes} B, outbound ${run.outbound.fetches} fetches ${run.outbound.bytes} B, back ${run.back.fetches} fetches ${run.back.bytes} B, duplicate ${run.total.duplicateBytes} B, settle ${run.outboundReport.settleMs.toFixed(0)} and ${run.backReport.settleMs.toFixed(0)} ms`,
  );
}

test.beforeEach(() => {
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
});

test(`a pan across ${slideFile} through six decode workers settles without a fetch storm and downloads no byte twice`, async ({
  page,
}) => {
  const run = await panRun(page, { workers: 6, reader: "shared-bytes" });
  save("workers-6", run);
  expect(run.outboundReport.errors).toEqual([]);
  expect(run.backReport.errors).toEqual([]);
  expect(run.outboundReport.decode?.size).toBe(6);
  expect(run.total.duplicateBytes).toBe(0);
  expect(run.total.fetches).toBe(run.backReport.decode?.network.fetches ?? -1);
});

test("the same pan decoding on the page through the shared byte cache", async ({ page }) => {
  const run = await panRun(page, { workers: 0, reader: "shared-bytes" });
  save("page-shared-bytes", run);
  expect(run.outboundReport.errors).toEqual([]);
  expect(run.outboundReport.decode).toBeNull();
  expect(run.total.duplicateBytes).toBe(0);
});

test("the same pan on the VIEW-002 path, with geotiff reading on the page", async ({ page }) => {
  const run = await panRun(page, { workers: 0, reader: "geotiff-direct" });
  save("page-geotiff-direct", run);
  expect(run.outboundReport.errors).toEqual([]);
});
