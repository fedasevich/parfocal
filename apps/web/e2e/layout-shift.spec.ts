import { expect, type Page, test } from "@playwright/test";

type Shift = { value: number; inPanel: boolean; nodes: string[] };

declare global {
  interface Window {
    __shifts?: Shift[];
  }
}

async function recordShifts(page: Page) {
  await page.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      })[]) {
        if (entry.hadRecentInput) continue;
        const nodes = (entry.sources ?? []).map((source) => source.node ?? null);
        const inPanel = nodes.some(
          (node) => node instanceof Element && node.closest('[aria-label="Side panel"]') !== null,
        );
        window.__shifts?.push({
          value: entry.value,
          inPanel,
          nodes: nodes.map((node) =>
            node instanceof Element
              ? `${node.tagName.toLowerCase()} ${node.textContent?.slice(0, 40) ?? ""}`
              : (node?.nodeName ?? "none"),
          ),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function runningHref(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · AI still running" });
  return (await link.getAttribute("href")) ?? "";
}

test("the case inspector does not shift while findings stream in", async ({ page }) => {
  test.setTimeout(90_000);
  const href = await runningHref(page);
  await recordShifts(page);
  await page.goto(`${href}&stream=1`);
  const panel = page.getByRole("complementary", { name: "Side panel" });
  const heading = panel.getByRole("heading", { name: /^Still reading this slide/ });
  const found = panel.getByRole("list", { name: "Found so far" }).getByRole("listitem");
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const first = await found.count();
  expect(first).toBeLessThan(4);
  await expect(heading).toHaveText(`Still reading this slide, ${first + 2} regions so far`, {
    timeout: 30_000,
  });
  await expect(found).toHaveCount(first + 2);
  await expect(panel.getByTestId("next-found")).toHaveCount(1);
  const shifts = await page.evaluate(() => window.__shifts ?? []);
  const panelShifts = shifts.filter((shift) => shift.inPanel);
  const cls = panelShifts.reduce((sum, shift) => sum + shift.value, 0);
  expect(panelShifts, JSON.stringify(panelShifts)).toEqual([]);
  expect(cls).toBe(0);
});

const pulseOf = (page: Page) =>
  page
    .getByTestId("next-found")
    .locator("[data-slot=skeleton]")
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        name: style.animationName,
        duration: style.animationDuration,
        running: node.getAnimations().some((animation) => animation.playState === "running"),
      };
    });

test("the skeleton pulses on the motion tokens and stands still under reduced motion", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const href = await runningHref(page);
  await page.goto(href);
  await expect(page.getByTestId("next-found")).toBeVisible({ timeout: 30_000 });
  expect(await pulseOf(page)).toEqual({ name: "pulse", duration: "2s", running: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await pulseOf(page)).toMatchObject({ running: false });
});
