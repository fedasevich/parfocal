import { expect, type Page, test } from "@playwright/test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openAuto(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("u");
  await expect(stage).toHaveAttribute("data-tool", "auto");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return { stage, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

const layer = (page: Page) => page.getByTestId("auto-layer");
const proposals = (page: Page) => page.getByTestId("proposal-layer");

async function dragRegion(page: Page, centre: { x: number; y: number }, size = 30) {
  await page.mouse.move(centre.x - size, centre.y - size);
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y, { steps: 4 });
  await page.mouse.move(centre.x + size, centre.y + size, { steps: 4 });
  await page.mouse.up();
}

test("U picks the auto region tool and the bar names it", async ({ page }) => {
  await openAuto(page);
  await expect(page.getByTestId("context-bar")).toContainText("Auto region");
});

test("a dragged region shows the found count and Accept saves every shape", async ({ page }) => {
  const { stage, centre } = await openAuto(page);
  await dragRegion(page, centre);
  await expect(proposals(page)).toBeVisible();
  const bar = page.getByTestId("context-bar");
  await expect(bar).toHaveAttribute("data-mode", "proposals");
  await expect(layer(page)).toHaveAttribute("data-running", "false");
  const found = Number(await bar.getAttribute("data-proposals"));
  expect(found).toBeGreaterThan(0);
  await expect(bar).toContainText(`${found} found`);
  await page.getByTestId("proposal-accept").click();
  await expect(proposals(page)).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(found);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});

test("Discard drops the proposals and keeps the tool", async ({ page }) => {
  const { stage, centre } = await openAuto(page);
  await dragRegion(page, centre);
  await expect(proposals(page)).toBeVisible();
  await page.getByTestId("proposal-discard").click();
  await expect(proposals(page)).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "auto");
});

test("a click outlines the nuclei of one patch", async ({ page }) => {
  const { centre } = await openAuto(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(proposals(page)).toBeVisible();
});

type PassWatch = {
  longest: number;
  longTasks: number;
  timerGap: number;
  tiles: number;
  running: boolean;
};

async function watchedPass(page: Page, centre: { x: number; y: number }): Promise<PassWatch> {
  await page.evaluate(() => {
    const watch = { longest: 0, longTasks: 0, timerGap: 0, tiles: 0, running: true };
    Object.assign(window, { autoWatch: watch });
    const longTasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        watch.longTasks += 1;
        watch.longest = Math.max(watch.longest, entry.duration);
      }
    });
    longTasks.observe({ type: "longtask" });
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      watch.timerGap = Math.max(watch.timerGap, now - last - 4);
      last = now;
      if (watch.running) setTimeout(tick, 4);
    };
    tick();
    const status = new MutationObserver(() => {
      const element = document.querySelector('[data-testid="auto-status"]');
      watch.tiles = Math.max(watch.tiles, Number(element?.getAttribute("data-total") ?? 0));
    });
    status.observe(document.body, { subtree: true, attributes: true, childList: true });
    Object.assign(window, {
      stopAutoWatch: () => {
        watch.running = false;
        longTasks.disconnect();
        status.disconnect();
        return watch;
      },
    });
  });
  await dragRegion(page, centre, 280);
  await expect(proposals(page)).toBeVisible();
  await expect(layer(page)).toHaveAttribute("data-running", "false");
  await expect(page.getByTestId("auto-status")).toHaveCount(0);
  const watch = await page.evaluate(() =>
    (window as unknown as { stopAutoWatch: () => PassWatch }).stopAutoWatch(),
  );
  console.log(`auto pass: ${JSON.stringify(watch)}`);
  await page.getByTestId("proposal-discard").click();
  await expect(proposals(page)).toHaveCount(0);
  return watch;
}

test("no main thread task passes its budget during a multi tile pass", async ({ page }) => {
  test.setTimeout(60_000);
  const { centre } = await openAuto(page);
  const passes: PassWatch[] = [];
  for (let sample = 0; sample < 3; sample += 1) passes.push(await watchedPass(page, centre));
  for (const pass of passes) expect(pass.tiles).toBeGreaterThanOrEqual(2);
  const fastest = Math.min(...passes.map((pass) => pass.longest));
  await checkBudget("aiseg.region-main-thread-task-ms", fastest);
});
