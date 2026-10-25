import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@parfocal/test-fixtures";
import { type Browser, type CDPSession, expect, type Page, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { type LatencyProxy, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import { type Served, serve } from "../test/pixel-source/serve.ts";
import { collectGarbage, liveObjects } from "./cdp.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import {
  type MainThreadSummary,
  summarizeMainThread,
  traceCategories,
} from "./main-thread-trace.ts";
import type { LifecycleSlide, LifecycleState } from "./page/lifecycle-harness.ts";

const slideFile = "CMU-1.svs";
const idleWindowMs = 10_000;
const idleTaskBudgetSeconds = 0.02;
const afterLastFrameMs = 2000;
const showToCompleteBudgetMs = 1000;
const hiddenMs = 1500;
const loadRttMs = 100;
const reportDir = fileURLToPath(new URL("../test-results/lifecycle-reports", import.meta.url));

const availability = fixtureAvailability(slideFile);

test.describe.configure({ mode: "serial", timeout: 120_000 });

let served: Served | null = null;
let direct: LatencyProxy | null = null;
let slow: LatencyProxy | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  if (availability.status !== "ready") return;
  served = await serve(
    { "/app": outDir, "/cache": fixturesDir() },
    { headers: crossOriginIsolated },
  );
  direct = await startLatencyProxy({ target: served.origin, rttMs: 0 });
  slow = await startLatencyProxy({ target: served.origin, rttMs: loadRttMs });
});

test.afterAll(async () => {
  await direct?.close();
  await slow?.close();
  await served?.close();
  direct = null;
  slow = null;
  served = null;
});

test.beforeEach(() => {
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
});

function slideAt(proxy: LatencyProxy, sleepWhenIdle: boolean): LifecycleSlide {
  return {
    url: `${proxy.url}/cache/${slideFile}`,
    formatId: "aperio-svs",
    workers: 6,
    magnification: 10,
    sleepWhenIdle,
    ...cmu1TissueCentre,
  };
}

async function openOn(page: Page, proxy: LatencyProxy, sleepWhenIdle = true): Promise<void> {
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertSwiftShader(page);
  await page.goto(`${proxy.url}/app/lifecycle.html`);
  await page.waitForFunction(() => window.lifecycleHarness !== undefined);
  await page.evaluate(
    (slide) => window.lifecycleHarness.open(slide),
    slideAt(proxy, sleepWhenIdle),
  );
}

function state(page: Page): Promise<LifecycleState> {
  return page.evaluate(() => window.lifecycleHarness.state());
}

async function settleAndSleep(page: Page): Promise<void> {
  await page.evaluate(() => window.lifecycleHarness.settle(60_000));
  await page.waitForFunction(() => window.lifecycleHarness.state().asleep, null, {
    polling: 100,
    timeout: 20_000,
  });
  await page.waitForTimeout(afterLastFrameMs);
}

interface MainThread {
  readonly task: number;
  readonly script: number;
  readonly layouts: number;
  readonly styles: number;
}

async function mainThread(cdp: CDPSession): Promise<MainThread> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const read = (name: string): number => {
    const metric = metrics.find((candidate) => candidate.name === name);
    if (metric === undefined) throw new Error(`Chrome reported no ${name}`);
    return metric.value;
  };
  return {
    task: read("TaskDuration"),
    script: read("ScriptDuration"),
    layouts: read("LayoutCount"),
    styles: read("RecalcStyleCount"),
  };
}

interface IdleReport {
  readonly windowMs: number;
  readonly frameRequests: number;
  readonly frameCallbacks: number;
  readonly timerCallbacks: number;
  readonly mainThreadMs: number;
  readonly trace: MainThreadSummary;
  readonly scriptMs: number;
  readonly layouts: number;
  readonly styleRecalcs: number;
}

async function idleWindow(page: Page, browser: Browser): Promise<IdleReport> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const before = await page.evaluate(() => window.frameProbe.counts());
  await browser.startTracing(undefined, { categories: [...traceCategories] });
  const threadBefore = await mainThread(cdp);
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, idleWindowMs));
  const threadAfter = await mainThread(cdp);
  const trace = summarizeMainThread(await browser.stopTracing());
  const windowMs = Date.now() - started;
  const after = await page.evaluate(() => window.frameProbe.counts());
  await cdp.detach();
  return {
    windowMs,
    frameRequests: after.frameRequests - before.frameRequests,
    frameCallbacks: after.frameCallbacks - before.frameCallbacks,
    timerCallbacks: after.timerCallbacks - before.timerCallbacks,
    mainThreadMs: (threadAfter.task - threadBefore.task) * 1000,
    trace,
    scriptMs: (threadAfter.script - threadBefore.script) * 1000,
    layouts: threadAfter.layouts - threadBefore.layouts,
    styleRecalcs: threadAfter.styles - threadBefore.styles,
  };
}

function save(name: string, report: unknown): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${name}: ${JSON.stringify(report)}`);
}

function expectQuiet(report: IdleReport): void {
  expect(report.frameRequests).toBe(0);
  expect(report.frameCallbacks).toBe(0);
  expect(report.timerCallbacks).toBe(0);
  expect(report.scriptMs).toBeLessThan(1);
  expect(report.layouts).toBe(0);
  expect(report.styleRecalcs).toBe(0);
  expect(report.trace.pageMs).toBeLessThan(idleTaskBudgetSeconds * 1000);
}

test(`an idle viewer over ${slideFile} runs no animation frame callbacks and under 20 ms of main-thread time in 10 s`, async ({
  page,
  browser,
}) => {
  if (direct === null) throw new Error("The slide server is not running");
  await openOn(page, direct);
  await settleAndSleep(page);
  const report = await idleWindow(page, browser);
  const final = await state(page);
  save("idle-after-open", { ...report, sleep: final.sleep });
  expectQuiet(report);
  expect(final.sleep?.rescues).toBe(0);
  expect(final.errors).toEqual([]);
});

test("the same window with idle sleep switched off keeps running frames, so the counter can see them", async ({
  page,
  browser,
}) => {
  if (direct === null) throw new Error("The slide server is not running");
  await openOn(page, direct, false);
  await page.evaluate(() => window.lifecycleHarness.settle(60_000));
  const report = await idleWindow(page, browser);
  save("idle-without-sleep", report);
  expect(report.frameCallbacks).toBeGreaterThan(100);
});

test("a viewer that has flown, panned and resized goes back to zero frames", async ({
  page,
  browser,
}) => {
  if (direct === null) throw new Error("The slide server is not running");
  await openOn(page, direct);
  await settleAndSleep(page);
  const home = (await state(page)).camera;
  await page.evaluate((target) => window.lifecycleHarness.startFlight(target), {
    ...home,
    x: home.x - 2500,
    y: home.y + 800,
  });
  await page.waitForFunction(() => window.lifecycleHarness.flight().end !== null, null, {
    polling: 50,
  });
  for (let step = 1; step <= 5; step++) {
    await page.evaluate((target) => window.lifecycleHarness.moveTo(target), {
      ...home,
      x: home.x - 2500 + step * 40,
      y: home.y + 800,
    });
  }
  await page.setViewportSize({ width: 1000, height: 600 });
  await settleAndSleep(page);
  const report = await idleWindow(page, browser);
  const final = await state(page);
  save("idle-after-interaction", { ...report, sleep: final.sleep });
  expectQuiet(report);
  expect(final.sleep?.rescues).toBe(0);
  expect(final.sleep?.wakes.resize).toBeGreaterThan(0);
  expect(final.errors).toEqual([]);
});

interface HiddenLoad {
  readonly toCompleteMs: number;
  readonly readsWhenHidden: number;
  readonly readsBeforeShow: number;
  readonly framesWhileHidden: number;
}

async function hideMidLoadAndShow(
  page: Page,
  mode: "hold" | "drop",
  readsBeforeHiding: number,
): Promise<HiddenLoad & { state: LifecycleState }> {
  if (slow === null) throw new Error("The slide server is not running");
  await openOn(page, slow);
  await page.waitForFunction(
    (reads) => (window.lifecycleHarness.state().sleep?.wakes.read ?? 0) >= reads,
    readsBeforeHiding,
    { polling: 5 },
  );
  const loading = await state(page);
  expect(loading.settled).toBe(false);

  await page.evaluate((next) => window.frameProbe.hide(next), mode);
  const hiddenFrom = await page.evaluate(() => window.frameProbe.counts());
  await page.waitForTimeout(hiddenMs);
  const hiddenTo = await page.evaluate(() => window.frameProbe.counts());
  const beforeShow = await state(page);

  await page.evaluate(() => window.frameProbe.show());
  const toCompleteMs = await page.evaluate(
    (timeout) => window.lifecycleHarness.waitUntilComplete(timeout),
    showToCompleteBudgetMs * 5,
  );
  return {
    toCompleteMs,
    readsWhenHidden: loading.sleep?.wakes.read ?? 0,
    readsBeforeShow: beforeShow.sleep?.wakes.read ?? 0,
    framesWhileHidden: hiddenTo.frameCallbacks - hiddenFrom.frameCallbacks,
    state: await state(page),
  };
}

for (const mode of ["hold", "drop"] as const) {
  test(`hiding the tab mid-load and showing it again completes the view within 1 s (frames ${mode === "hold" ? "held until the tab returns, as Chrome does" : "dropped, as in a worker"})`, async ({
    page,
  }) => {
    const { state: final, ...report } = await hideMidLoadAndShow(page, mode, 3);
    save(`hidden-mid-load-${mode}`, { ...report, sleep: final.sleep });
    expect(report.framesWhileHidden).toBe(0);
    expect(report.toCompleteMs).toBeLessThan(showToCompleteBudgetMs);
    expect(final.errors).toEqual([]);
    expect(final.sleep?.rescues).toBe(0);
  });
}

test("a tab hidden before the first tile read has only throttled timers to start the load, and still completes within 2 s of returning", async ({
  page,
}) => {
  const { state: final, ...report } = await hideMidLoadAndShow(page, "hold", 0);
  save("hidden-before-first-read", { ...report, sleep: final.sleep });
  expect(report.toCompleteMs).toBeLessThan(showToCompleteBudgetMs * 2);
  expect(final.errors).toEqual([]);
});

test("a flight running when the tab is hidden lands on its target at once, and one started while hidden does too", async ({
  page,
}) => {
  if (direct === null) throw new Error("The slide server is not running");
  await openOn(page, direct);
  await settleAndSleep(page);
  const home = (await state(page)).camera;
  const first = { ...home, x: home.x - 4000, y: home.y + 1500 };
  const second = { ...home, x: home.x + 3000, y: home.y - 1000 };

  await page.evaluate((target) => window.lifecycleHarness.startFlight(target), first);
  await page.waitForTimeout(100);
  expect((await state(page)).motion).toBe("flying");
  await page.evaluate(() => window.frameProbe.hide("drop"));
  await page.waitForFunction(() => window.lifecycleHarness.flight().end !== null, null, {
    polling: 20,
    timeout: 1000,
  });
  const landed = await page.evaluate(() => window.lifecycleHarness.flight());
  expect(landed.end).toBe("arrived");
  expect(landed.camera).toEqual(first);

  await page.evaluate((target) => window.lifecycleHarness.startFlight(target), second);
  await page.waitForFunction(() => window.lifecycleHarness.flight().end !== null, null, {
    polling: 20,
    timeout: 1000,
  });
  const startedHidden = await page.evaluate(() => window.lifecycleHarness.flight());
  expect(startedHidden.end).toBe("arrived");
  expect(startedHidden.camera).toEqual(second);
  expect(startedHidden.settledAtMs).toBeLessThan(250);

  await page.evaluate(() => window.frameProbe.show());
  await page.evaluate(() => window.lifecycleHarness.waitUntilComplete(10_000));
  const final = await state(page);
  expect(final.camera).toEqual(second);
  expect(final.errors).toEqual([]);
});

test("with animation frames starved in a visible tab the watchdog still completes the view", async ({
  page,
}) => {
  if (direct === null) throw new Error("The slide server is not running");
  await openOn(page, direct);
  await settleAndSleep(page);
  const home = (await state(page)).camera;
  await page.evaluate(() => window.frameProbe.starve(true));
  const before = await page.evaluate(() => window.frameProbe.counts());
  const notified = (await state(page)).notifications;
  await page.evaluate((target) => window.lifecycleHarness.moveTo(target), {
    ...home,
    x: home.x + 5000,
    y: home.y + 2000,
  });
  const toComplete = await page.evaluate(() => window.lifecycleHarness.waitUntilComplete(20_000));
  const after = await page.evaluate(() => window.frameProbe.counts());
  const final = await state(page);
  save("watchdog-starved-frames", { toCompleteMs: toComplete, sleep: final.sleep });
  expect(after.frameCallbacks - before.frameCallbacks).toBe(0);
  expect(final.notifications).toBeGreaterThan(notified);
  expect(final.errors).toEqual([]);
  await page.evaluate(() => window.frameProbe.starve(false));
});

test("disposing a sleeping viewer releases its deck, its parked frame callback and its tab listeners", async ({
  page,
}) => {
  if (direct === null) throw new Error("The slide server is not running");
  await openOn(page, direct);
  await settleAndSleep(page);
  expect(await page.evaluate(() => window.frameProbe.visibilityListeners())).toBeGreaterThan(0);
  await page.evaluate(() => window.lifecycleHarness.close());
  expect(await page.evaluate(() => window.frameProbe.visibilityListeners())).toBe(0);
  const cdp = await page.context().newCDPSession(page);
  let decks = -1;
  for (let attempt = 0; attempt < 5 && decks !== 0; attempt++) {
    await collectGarbage(cdp);
    decks = await liveObjects(cdp, "window.lifecycleHarness.prototypes.deck");
  }
  await cdp.detach();
  expect(decks).toBe(0);
});
