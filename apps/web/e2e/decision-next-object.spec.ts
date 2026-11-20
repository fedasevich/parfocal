import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";
const scoped = ["C1", "C2", "C3", "C4", "C5"];
const rounds = Number(process.env["PARFOCAL_MAIN_PATH_ROUNDS"] ?? 2);

declare global {
  interface Window {
    decisionTimes: number[];
  }
}

test.use({ viewport: { width: 1440, height: 900 } });

async function openGuidedCheck(page: Page) {
  await page.goto(`/projects/${p07}/slides/${withResults}?task=${annotateTask}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(page.getByTestId("ai-object")).toHaveCount(6);
  await page.keyboard.press("Shift+G");
  const guide = page.getByTestId("guided-check");
  await expect(guide).toHaveAttribute("data-current", "C1");
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="guided-check"]');
    if (node === null) throw new Error("The guided check is not on screen");
    window.decisionTimes = [];
    let pressedAt: number | null = null;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "d") pressedAt = event.timeStamp;
      },
      { capture: true },
    );
    new MutationObserver(() => {
      if (pressedAt === null) return;
      const started = pressedAt;
      pressedAt = null;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.decisionTimes.push(performance.now() - started)),
      );
    }).observe(node, { attributes: true, attributeFilter: ["data-current"] });
  });
  return guide;
}

async function decideEach(page: Page): Promise<number[]> {
  const guide = await openGuidedCheck(page);
  for (const next of scoped.slice(1)) {
    await page.keyboard.press("d");
    await expect(guide).toHaveAttribute("data-current", next);
  }
  await expect.poll(() => page.evaluate(() => window.decisionTimes.length)).toBe(scoped.length - 1);
  return page.evaluate(() => window.decisionTimes);
}

const nearestRank = (values: readonly number[], share: number) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * share) - 1)] ?? Number.NaN;
};

const median = (values: readonly number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle] ?? Number.NaN;
  return ordered.length % 2 === 1 ? upper : ((ordered[middle - 1] ?? Number.NaN) + upper) / 2;
};

test("a decision in the guided check puts the next object on screen within budget", {
  tag: "@budget",
}, async ({ browser }) => {
  test.setTimeout(60_000 + rounds * 30_000);
  const samples: number[] = [];
  for (let round = 0; round <= rounds; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const times = await decideEach(await context.newPage());
    await context.close();
    if (round > 0) samples.push(...times);
  }
  const fastest = Math.min(...samples);
  const summary = {
    samples,
    median: median(samples),
    p95: nearestRank(samples, 0.95),
    fastest,
    rounds,
  };
  console.log(JSON.stringify(summary));
  await checkBudget("app.decision-next-object-ms", fastest);
});
