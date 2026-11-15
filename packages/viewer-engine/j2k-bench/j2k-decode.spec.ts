import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@parfocal/test-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { fromFile } from "geotiff";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { startLatencyProxy } from "../../latency-proxy/src/index.ts";
import type { PanSlide } from "../browser/page/pan-harness.ts";
import type { Served } from "../test/pixel-source/serve.ts";
import { buildAndServe, pagePath } from "./global-setup.ts";
import type { FrameWindow, GpuInfo, ThroughputReport } from "./page/j2k-bench-harness.ts";

interface View {
  readonly name: string;
  readonly magnification: number;
  readonly downsample: number;
}

interface Slide {
  readonly file: string;
  readonly codec: string;
  readonly tileSize: number;
  readonly centre: { readonly x: number; readonly y: number };
  readonly block: readonly [number, number];
  readonly views: readonly View[];
}

const slides: readonly Slide[] = [
  {
    file: "CMU-1.svs",
    codec: "JPEG",
    tileSize: 256,
    centre: cmu1TissueCentre,
    block: [109, 38],
    views: [
      { name: "10x", magnification: 10, downsample: 2 },
      { name: "20x finest", magnification: 20, downsample: 1 },
    ],
  },
  {
    file: "CMU-1-JP2K-33005.svs",
    codec: "JPEG 2000 33005",
    tileSize: 240,
    centre: cmu1TissueCentre,
    block: [116, 41],
    views: [
      { name: "10x", magnification: 10, downsample: 2 },
      { name: "20x finest", magnification: 20, downsample: 1 },
    ],
  },
  {
    file: "JP2K-33003-1.svs",
    codec: "JPEG 2000 33003",
    tileSize: 256,
    centre: { x: 10_752, y: 12_288 },
    block: [39, 45],
    views: [
      { name: "10x", magnification: 10, downsample: 4 },
      { name: "20x", magnification: 20, downsample: 2 },
      { name: "40x finest", magnification: 40, downsample: 1 },
    ],
  },
];

const smoke = process.env["J2K_BENCH_SMOKE"] === "1";
const repetitions = smoke ? 1 : 3;
const rtts: readonly number[] = smoke ? [0] : [0, 200];
const workerCounts: readonly number[] = smoke ? [6] : [1, 2, 4, 6, 8];
const jumpWorkerCounts: readonly number[] = smoke ? [] : [2, 4, 8];
const blockSide = smoke ? 2 : 6;
const panPxPerSecond = 1000;
const panMs = smoke ? 1000 : 3000;
const settleTimeoutMs = 120_000;
const reportDir = fileURLToPath(new URL("../test-results/j2k-bench", import.meta.url));

function blockTiles(slide: Slide): (readonly [number, number])[] {
  const tiles: (readonly [number, number])[] = [];
  for (let row = 0; row < blockSide; row++) {
    for (let column = 0; column < blockSide; column++) {
      tiles.push([slide.block[0] + column, slide.block[1] + row]);
    }
  }
  return tiles;
}

async function rawTiles(slide: Slide): Promise<Buffer[]> {
  const path = `${fixturesDir()}/${slide.file}`;
  const tiff = await fromFile(path);
  const image = await tiff.getImage(0);
  const across = Math.ceil(image.getWidth() / image.getTileWidth());
  const file = openSync(path, "r");
  try {
    const tiles: Buffer[] = [];
    for (const [column, row] of blockTiles(slide)) {
      const index = row * across + column;
      const offset = Number(await image.fileDirectory.loadValueIndexed("TileOffsets", index));
      const length = Number(await image.fileDirectory.loadValueIndexed("TileByteCounts", index));
      const bytes = Buffer.alloc(length);
      readSync(file, bytes, 0, length, offset);
      tiles.push(bytes);
    }
    return tiles;
  } finally {
    closeSync(file);
    await tiff.close();
  }
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function machine(): { loadAverage: number; memoryFree: string } {
  let memoryFree = "unknown";
  try {
    const lines = execFileSync("memory_pressure", { encoding: "utf8" }).trim().split("\n");
    memoryFree = lines.at(-1)?.split(":").at(-1)?.trim() ?? "unknown";
  } catch {
    memoryFree = "unknown";
  }
  return { loadAverage: Number((loadavg()[0] ?? 0).toFixed(1)), memoryFree };
}

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function fresh(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}${pagePath}`);
  await page.waitForFunction(
    () => window.panHarness !== undefined && window.j2kBench !== undefined,
  );
}

function panSlide(origin: string, slide: Slide, workers: number): PanSlide {
  return {
    url: `${origin}/cache/${slide.file}`,
    formatId: "aperio-svs",
    workers,
    reader: "shared-bytes",
    magnification: null,
    ...slide.centre,
  };
}

let served: Served | null = null;

test.beforeAll(async () => {
  for (const slide of slides) {
    const availability = fixtureAvailability(slide.file);
    if (availability.status !== "ready") throw new Error(`${slide.file} is not in the cache`);
  }
  served = await buildAndServe();
});

test.afterAll(async () => {
  await served?.close();
  served = null;
});

test("JPEG 2000 decode cost against JPEG on the hardware GPU", async ({ page }) => {
  if (served === null) throw new Error("The slide server is not running");
  const origin = served.origin;
  const phases: Record<string, ReturnType<typeof machine>> = { start: machine() };

  await fresh(page, origin);
  const gpu: GpuInfo = await page.evaluate(() => window.j2kBench.gpu());
  console.log(`GPU: ${gpu.renderer} (${gpu.vendor}), frame ${gpu.refreshIntervalMs.toFixed(2)} ms`);
  expect(gpu.renderer ?? "").not.toMatch(/swiftshader/i);

  const codecRows = [];
  const tileBytes: Record<string, number> = {};
  for (const slide of slides) {
    const raw = await rawTiles(slide);
    tileBytes[slide.file] = Math.round(
      raw.reduce((sum, tile) => sum + tile.length, 0) / raw.length,
    );
    if (slide.codec === "JPEG") continue;
    const encoded = raw.map((tile) => tile.toString("base64"));
    for (const reduce of [0, 1, 2]) {
      await fresh(page, origin);
      const reply = await page.evaluate(
        ({ tiles, repeats, level }) => window.j2kBench.codec(tiles, repeats, level),
        { tiles: encoded, repeats: repetitions, level: reduce },
      );
      expect(reply.error).toBeNull();
      const row = {
        slide: slide.file,
        codec: slide.codec,
        reduce,
        width: reply.width,
        height: reply.height,
        decompositions: reply.decompositions,
        samples: reply.decodeMs.length,
        instantiateMs: reply.instantiateMs,
        p50Ms: percentile(reply.decodeMs, 0.5),
        p95Ms: percentile(reply.decodeMs, 0.95),
        worstMs: Math.max(...reply.decodeMs),
      };
      codecRows.push(row);
      console.log(
        `codec ${slide.file} reduce ${reduce} (${row.width}x${row.height}, ${row.decompositions} decompositions): p50 ${row.p50Ms.toFixed(2)} ms, p95 ${row.p95Ms.toFixed(2)} ms, worst ${row.worstMs.toFixed(2)} ms, instantiate ${row.instantiateMs.toFixed(0)} ms, ${row.samples} samples`,
      );
    }
  }
  console.log(`mean tile bytes: ${JSON.stringify(tileBytes)}`);
  phases["after codec"] = machine();

  const tileRows = [];
  for (const slide of slides) {
    await fresh(page, origin);
    const report = await page.evaluate((request) => window.j2kBench.tiles(request), {
      url: `${origin}/cache/${slide.file}`,
      formatId: "aperio-svs" as const,
      level: 0,
      tileSize: slide.tileSize,
      tiles: blockTiles(slide),
      repeats: repetitions,
    });
    expect(report.error).toBeNull();
    const row = {
      slide: slide.file,
      codec: slide.codec,
      tileSize: slide.tileSize,
      samples: report.warmMs.length,
      coldFirstMs: report.coldFirstMs,
      p50Ms: percentile(report.warmMs, 0.5),
      p95Ms: percentile(report.warmMs, 0.95),
      worstMs: Math.max(...report.warmMs),
    };
    tileRows.push(row);
    console.log(
      `tile ${slide.file}: p50 ${row.p50Ms.toFixed(1)} ms, p95 ${row.p95Ms.toFixed(1)} ms, worst ${row.worstMs.toFixed(1)} ms, first cold ${row.coldFirstMs.toFixed(0)} ms, ${row.samples} samples`,
    );
  }
  phases["after tiles"] = machine();

  const throughputRows: (ThroughputReport & { slide: string; tilesPerSecond: number })[] = [];
  for (const workers of workerCounts) {
    for (const slide of slides) {
      await fresh(page, origin);
      const report = await page.evaluate((request) => window.j2kBench.throughput(request), {
        url: `${origin}/cache/${slide.file}`,
        formatId: "aperio-svs" as const,
        level: 0,
        tileSize: slide.tileSize,
        tiles: blockTiles(slide),
        repeats: repetitions,
        workers,
      });
      expect(report.error).toBeNull();
      const tilesPerSecond = (report.tiles / report.warmMs) * 1000;
      throughputRows.push({ slide: slide.file, ...report, tilesPerSecond });
      console.log(
        `throughput ${slide.file} workers ${workers}: ${report.tiles} tiles warm ${report.warmMs.toFixed(0)} ms (${tilesPerSecond.toFixed(0)} tiles/s), cold ${report.coldMs.toFixed(0)} ms`,
      );
    }
  }
  phases["after throughput"] = machine();

  const loadRows = [];
  const loads: { rttMs: number; workers: number }[] = [
    ...rtts.map((rttMs) => ({ rttMs, workers: 6 })),
    ...jumpWorkerCounts.map((workers) => ({ rttMs: 0, workers })),
  ];
  for (const { rttMs, workers } of loads) {
    const proxy = await startLatencyProxy({ target: origin, rttMs });
    try {
      const fitted = new Map<string, number[]>();
      const sharp = new Map<string, number[]>();
      for (let round = 0; round < repetitions; round++) {
        for (const slide of slides) {
          for (const view of slide.views) {
            await fresh(page, proxy.url);
            const opened = await page.evaluate(
              (next) => window.panHarness.open(next),
              panSlide(proxy.url, slide, workers),
            );
            const jumped = await page.evaluate(
              ({ target, timeout }) => window.panHarness.jump(target, timeout),
              {
                target: { magnification: view.magnification, ...slide.centre },
                timeout: settleTimeoutMs,
              },
            );
            await page.evaluate(() => window.panHarness.close());
            expect(jumped.errors).toEqual([]);
            fitted.set(slide.file, [...(fitted.get(slide.file) ?? []), opened.openMs]);
            const key = `${slide.file}|${view.name}`;
            sharp.set(key, [...(sharp.get(key) ?? []), jumped.sharpMs]);
          }
        }
      }
      for (const slide of slides) {
        const fits = fitted.get(slide.file) ?? [];
        for (const view of slide.views) {
          const times = sharp.get(`${slide.file}|${view.name}`) ?? [];
          const row = {
            rttMs,
            workers,
            slide: slide.file,
            view: view.name,
            downsample: view.downsample,
            fittedFastestMs: Math.min(...fits),
            fittedSlowestMs: Math.max(...fits),
            sharpFastestMs: Math.min(...times),
            sharpSlowestMs: Math.max(...times),
          };
          loadRows.push(row);
          console.log(
            `load rtt ${rttMs} workers ${workers} ${slide.file} ${view.name}: fitted ${row.fittedFastestMs.toFixed(0)} ms, sharp ${row.sharpFastestMs.toFixed(0)} to ${row.sharpSlowestMs.toFixed(0)} ms`,
          );
        }
      }
    } finally {
      await proxy.close();
    }
  }
  phases["after loads"] = machine();

  const panRows: {
    slide: string;
    view: string;
    round: number;
    motion: FrameWindow;
    settle: FrameWindow;
    settleMs: number;
    decodeP95Ms: number | null;
    completed: number;
  }[] = [];
  for (let round = 0; round < repetitions; round++) {
    for (const slide of slides) {
      for (const view of slide.views.filter((entry) => entry.downsample <= 2)) {
        await fresh(page, origin);
        const travel = (panPxPerSecond * panMs * view.downsample) / 1000;
        await page.evaluate((next) => window.panHarness.open(next), {
          ...panSlide(origin, slide, 6),
          magnification: view.magnification,
          x: slide.centre.x - travel / 2,
        });
        const result = await page.evaluate(
          async ({ plan, timeout }) => {
            window.j2kBench.startFrames();
            const report = await window.panHarness.drive(plan, timeout);
            return { report, frames: window.j2kBench.stopFrames(report.elapsedMs) };
          },
          {
            plan: { pxPerSecond: panPxPerSecond, ms: panMs, zigzagPx: 0, vertical: false },
            timeout: settleTimeoutMs,
          },
        );
        await page.evaluate(() => window.panHarness.close());
        expect(result.report.errors).toEqual([]);
        panRows.push({
          slide: slide.file,
          view: view.name,
          round,
          motion: result.frames.motion,
          settle: result.frames.settle,
          settleMs: result.report.settleMs,
          decodeP95Ms: result.report.decode?.decodeP95Ms ?? null,
          completed: result.report.decode?.completed ?? 0,
        });
        console.log(
          `pan ${slide.file} ${view.name} round ${round}: frame p50 ${result.frames.motion.p50Ms.toFixed(1)} p95 ${result.frames.motion.p95Ms.toFixed(1)} worst ${result.frames.motion.worstMs.toFixed(1)} ms over ${result.frames.motion.frames} frames, ${result.frames.motion.over33Ms} over 33 ms, settle ${result.report.settleMs.toFixed(0)} ms, ${result.report.decode?.completed ?? 0} decodes`,
        );
      }
    }
  }
  phases["after pans"] = machine();

  mkdirSync(reportDir, { recursive: true });
  const file = `${reportDir}/${smoke ? "smoke" : "report"}.json`;
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        commit: commit(),
        smoke,
        gpu,
        viewport: page.viewportSize(),
        repetitions,
        panPxPerSecond,
        panMs,
        machine: phases,
        tileBytes,
        codec: codecRows,
        tiles: tileRows,
        throughput: throughputRows,
        loads: loadRows,
        pans: panRows,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Report: ${file}`);
});
