import { fixturesDir } from "@parfocal/test-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { RTT_MATRIX_MS, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import { type Served, type ServedRequest, serve } from "../test/pixel-source/serve.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import type { PanSlide } from "./page/pan-harness.ts";

const slideFile = "CMU-1.svs";
const slidePath = `/cache/${slideFile}`;
const repetitions = 3;
const settleTimeoutMs = 60_000;
const jumpTarget = { magnification: 10, ...cmu1TissueCentre };
const availability = fixtureAvailability(slideFile);

interface Phase {
  readonly ms: number;
  readonly requests: number;
  readonly bytes: number;
}

interface Sample {
  readonly fitted: Phase;
  readonly jump: Phase;
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

let served: Served | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  if (availability.status !== "ready") return;
  served = await serve(
    { "/app": outDir, "/cache": fixturesDir() },
    { headers: crossOriginIsolated },
  );
});

test.afterAll(async () => {
  await served?.close();
  served = null;
});

test.beforeEach(() => {
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
});

function slideTraffic(entries: readonly ServedRequest[]): Omit<Phase, "ms"> {
  const slide = entries.filter((entry) => entry.path === slidePath);
  return {
    requests: slide.length,
    bytes: slide.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

async function sample(page: Page, origin: string): Promise<Sample> {
  if (served === null) throw new Error("The slide server is not running");
  const log = served.log;
  await page.goto(`${origin}/app/pan.html`);
  await page.waitForFunction(() => window.panHarness !== undefined);
  const start = log.length;
  const slide: PanSlide = {
    url: `${origin}${slidePath}`,
    formatId: "aperio-svs",
    workers: 6,
    reader: "shared-bytes",
    magnification: null,
    ...cmu1TissueCentre,
  };
  const opened = await page.evaluate((next) => window.panHarness.open(next), slide);
  const fittedAt = log.length;
  const jumped = await page.evaluate(
    ({ target, timeout }) => window.panHarness.jump(target, timeout),
    { target: jumpTarget, timeout: settleTimeoutMs },
  );
  await page.evaluate(() => window.panHarness.close());
  expect(jumped.errors).toEqual([]);
  return {
    fitted: { ms: opened.openMs, ...slideTraffic(log.slice(start, fittedAt)) },
    jump: { ms: jumped.sharpMs, ...slideTraffic(log.slice(fittedAt)) },
  };
}

function fastest(samples: readonly Sample[], phase: keyof Sample): Phase {
  const phases = samples.map((entry) => entry[phase]);
  return {
    ms: Math.min(...phases.map((entry) => entry.ms)),
    requests: Math.max(...phases.map((entry) => entry.requests)),
    bytes: Math.max(...phases.map((entry) => entry.bytes)),
  };
}

for (const rttMs of RTT_MATRIX_MS) {
  test(`CMU-1.svs reaches the fitted image and sharp after a jump to 10x within budget at ${rttMs} ms RTT`, async ({
    page,
  }, testInfo) => {
    if (served === null) throw new Error("The slide server is not running");
    await page.setContent("<!doctype html><html><body></body></html>");
    await assertSwiftShader(page);
    const proxy = await startLatencyProxy({ target: served.origin, rttMs });
    const samples: Sample[] = [];
    try {
      for (let round = 0; round < repetitions; round++) {
        samples.push(await sample(page, proxy.url));
      }
    } finally {
      await proxy.close();
    }
    const fitted = fastest(samples, "fitted");
    const jump = fastest(samples, "jump");
    const description = `rtt ${rttMs} ms, fastest of ${repetitions}: fitted ${fitted.ms.toFixed(0)} ms, ${fitted.requests} requests, ${fitted.bytes} B; sharp after jump ${jump.ms.toFixed(0)} ms, ${jump.requests} requests, ${jump.bytes} B`;
    testInfo.annotations.push({ type: "perf", description });
    console.log(description);
    const measured = {
      "viewer.fitted-requests": fitted.requests,
      "viewer.fitted-bytes": fitted.bytes,
      "viewer.fitted-ms": fitted.ms,
      "viewer.jump-requests": jump.requests,
      "viewer.jump-bytes": jump.bytes,
      "viewer.jump-sharp-ms": jump.ms,
    };
    for (const [id, value] of Object.entries(measured)) {
      await checkBudget(id, value, { rttMs });
    }
  });
}
