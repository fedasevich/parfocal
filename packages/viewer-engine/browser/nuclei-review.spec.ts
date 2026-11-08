import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { type SyntheticSlide, syntheticSlide } from "../test/nuclei/synthetic.ts";
import { collectGarbage, harnessUrl, heapBytes } from "./cdp.ts";
import type { ReviewReport } from "./page/nuclei-review-harness.ts";

const cells = Number(process.env.PARFOCAL_REVIEW_CELLS ?? 1_000_000);
const classes = 4;
const heapLimitBytes = 100 * 1024 * 1024;
const view = { width: 5760, height: 3840 };
const reportDir = fileURLToPath(new URL("../test-results/nuclei-review", import.meta.url));

let slide: SyntheticSlide | null = null;
let server: Server | null = null;
let origin = "";

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async () => {
  slide = syntheticSlide({ cells, classes, verticesPerCell: 19 });
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
      response.writeHead(200, headers);
      response.end(slide.summary);
      return;
    }
    const match = /^\/chunk\/(\d+)$/.exec(path);
    const index = match ? Number(match[1]) : -1;
    if (!slide || index < 0 || index >= slide.chunks) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, headers);
    response.end(slide.chunk(index));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  slide = null;
});

test(`a reviewer checks cells on a ${cells.toLocaleString("en")} nucleus paged result by confidence`, async ({
  page,
}) => {
  if (!slide) throw new Error("No slide");
  await page.goto(harnessUrl("/app/nuclei-review.html"));
  await page.waitForFunction(() => window.reviewHarness !== undefined);
  const report: ReviewReport = await page.evaluate((config) => window.reviewHarness.run(config), {
    origin,
    slideWidth: slide.width,
    slideHeight: slide.height,
    viewWidth: view.width,
    viewHeight: view.height,
    galleryLimit: 24,
    awayViews: 4,
    vertexBudget: 1_500_000,
  });
  const cdp = await page.context().newCDPSession(page);
  await collectGarbage(cdp);
  const memory =
    (await heapBytes(cdp)) + (await page.evaluate(() => window.reviewHarness.heldBytes()));
  await cdp.detach();
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "report.json"), JSON.stringify({ cells, memory, report }, null, 2));
  console.log(
    `${cells} cells, open ${report.openMs.toFixed(0)} ms, first view ${report.firstViewMs.toFixed(0)} ms, gallery ${report.galleryMs.toFixed(0)} ms, ${report.fadeFirst.outlines} faded outlines, ${report.fadeFirst.distinctAlphas} alphas, memory ${(memory / 1024 / 1024).toFixed(1)} MB`,
  );

  expect(report.paged).toBe(true);
  expect(report.cells).toBe(cells);
  expect(report.classes).toBe(classes);
  expect(report.fadeFirst.outlines).toBeGreaterThan(0);
  expect(report.fadeFirst.polygons).toBe(report.fadeFirst.outlines);
  expect(report.fadeFirst.wrongAlphas).toBe(0);
  expect(report.fadeFirst.distinctAlphas).toBeGreaterThan(50);
  expect(report.gallery).toBe(24);
  expect(report.galleryAllUnsure).toBe(true);
  expect(report.galleryLeastSureFirst).toBe(true);
  expect(report.reviewed).toHaveLength(6);
  expect(report.lookupsMatchedGallery).toBe(true);
  expect(report.firstChunkEvicted).toBe(true);
  expect(report.probsSurvivedEviction).toBe(true);
  expect(report.decisionsSurvivedEviction).toBe(true);
  expect(report.removedLeftGallery).toBe(true);
  expect(report.fadeBack.wrongAlphas).toBe(0);
  expect(report.fadeBack.outlines).toBeGreaterThan(0);
  expect(memory).toBeLessThan(heapLimitBytes);
});
