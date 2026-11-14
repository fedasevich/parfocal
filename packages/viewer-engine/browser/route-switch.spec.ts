import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CDPSession, expect, test } from "@playwright/test";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import type { RendererRouteId } from "../src/index.ts";
import { collectGarbage, harnessUrl, heapBytes, liveObjects } from "./cdp.ts";
import type { RouteSwitchReport, RouteSwitchSlide } from "./page/route-switch-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/memory-reports", import.meta.url));

const slideFile = "CMU-1-Small-Region.svs";
const camera = { x: 1100, y: 1500, zoom: -1 };
const switches = Number(process.env.ROUTE_SWITCHES ?? 10);
const minWarmUpSwitches = 5;
const heapBudget = 0.1;
const releaseWaitMs = 5_000;

interface Sample {
  readonly round: number;
  readonly heapBytes: number;
  readonly decks: number;
  readonly report: RouteSwitchReport;
}

async function liveDecks(cdp: CDPSession): Promise<number> {
  await collectGarbage(cdp);
  return liveObjects(cdp, "window.routeSwitchHarness.prototypes.deck");
}

test("10 renderer route switches keep the camera, one canvas and the heap within 10% of baseline", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setContent("<!doctype html><html><body></body></html>");
  const renderer = await assertSwiftShader(page);
  await page.goto(harnessUrl("/app/route-switch.html"));
  await page.waitForFunction(() => window.routeSwitchHarness !== undefined);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");

  const routes: readonly RendererRouteId[] = await page.evaluate(() =>
    window.routeSwitchHarness.routes(),
  );
  expect(routes[0]).toBe("viv");
  const warmUpSwitches = Math.max(routes.length, minWarmUpSwitches);
  const routeAt = (round: number): RendererRouteId => {
    const route = routes[round % routes.length];
    if (route === undefined) throw new Error("No renderer route is registered");
    return route;
  };

  const slide: RouteSwitchSlide = {
    url: harnessUrl(`/cache/${slideFile}`),
    formatId: "aperio-svs",
    camera,
  };
  const opened = await page.evaluate((next) => window.routeSwitchHarness.open(next), slide);
  expect(opened.errors).toEqual([]);
  expect(opened.camera).toEqual(camera);

  const samples: Sample[] = [];
  for (let round = 1; round <= warmUpSwitches + switches; round += 1) {
    const report = await page.evaluate(
      (route) => window.routeSwitchHarness.switchTo(route),
      routeAt(round),
    );
    const decks = await liveDecks(cdp);
    samples.push({ round, heapBytes: await heapBytes(cdp), decks, report });
  }

  const canvases = await page.evaluate(() => window.routeSwitchHarness.dispose());
  const disposedAt = Date.now();
  let decksAfter = await liveDecks(cdp);
  while (decksAfter > 0 && Date.now() - disposedAt < releaseWaitMs) {
    await page.waitForTimeout(25);
    decksAfter = await liveDecks(cdp);
  }
  await cdp.detach();

  const baseline = samples[warmUpSwitches - 1];
  const last = samples.at(-1);
  if (!baseline || !last) throw new Error("The run has no samples");
  const growth = last.heapBytes / baseline.heapBytes - 1;
  const megabytes = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
  console.log(
    [
      `routes=${routes.join(",")} renderer=${renderer}`,
      "round\troute\theap MB\tdecks\tcanvases\tswitch ms",
      ...samples.map(
        (sample) =>
          `${sample.round}\t${sample.report.route}\t${megabytes(sample.heapBytes)}\t${sample.decks}\t${sample.report.canvases}\t${sample.report.switchMs.toFixed(0)}`,
      ),
      `growth ${(growth * 100).toFixed(1)}% after ${warmUpSwitches} warm-up, decks ${decksAfter} and canvases ${canvases} after dispose`,
    ].join("\n"),
  );
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, "route-switch.json"),
    `${JSON.stringify({ renderer, routes, warmUpSwitches, samples, growth, decksAfter, canvases }, null, 2)}\n`,
  );

  expect(samples.map((sample) => sample.report.errors)).toEqual(samples.map(() => []));
  expect(samples.map((sample) => sample.report.route)).toEqual(
    samples.map((sample) => routeAt(sample.round)),
  );
  expect(samples.map((sample) => sample.report.camera)).toEqual(samples.map(() => camera));
  expect(samples.map((sample) => sample.report.canvases)).toEqual(samples.map(() => 1));
  expect(samples.map((sample) => sample.decks)).toEqual(
    samples.map((sample) => (sample.report.route === "custom-webgpu" ? 0 : 1)),
  );
  expect(growth).toBeLessThanOrEqual(heapBudget);
  expect(decksAfter).toBe(0);
  expect(canvases).toBe(0);
});
