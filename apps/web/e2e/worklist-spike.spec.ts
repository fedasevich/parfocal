import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "./a11y.ts";

const grid = (page: Page) => page.getByRole("table", { name: "Worklist" });
const bodyRows = (page: Page) => grid(page).locator("tbody tr");

test("10,000 rows render as a window and J, K, Home and End move the active row", async ({
  page,
}) => {
  await page.goto("/spikes/worklist");
  await expect(page.getByText("10,000 rows, virtual")).toBeVisible();
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "10001");
  expect(await bodyRows(page).count()).toBeLessThan(80);

  for (const key of ["j", "j", "j", "k"]) await page.keyboard.press(key);
  await expect(grid(page)).toHaveAttribute("data-active-index", "2");
  await expect(page.locator("#worklist-row-2")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("End");
  await expect(page.locator("#worklist-row-9999")).toBeInViewport();
  await expect(page.locator("#worklist-row-9999")).toContainText("S-19999");
  await page.keyboard.press("k");
  await expect(page.locator("#worklist-row-9998")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Home");
  await expect(page.locator("#worklist-row-0")).toBeInViewport();
  for (let press = 0; press < 30; press += 1) await page.keyboard.press("j");
  await expect(page.locator("#worklist-row-30")).toBeInViewport();
  expect(await bodyRows(page).count()).toBeLessThan(80);
});

type FrameStats = {
  frames: number;
  seconds: number;
  fps: number;
  p95FrameMs: number;
  longestFrameMs: number;
  framesOver17Ms: number;
  framesOver25Ms: number;
  activeIndexAtEnd: number;
};

async function measure(page: Page, drive: "keys" | "scroll", seconds: number) {
  return page.evaluate(
    ({ drive, seconds }) =>
      new Promise<FrameStats>((resolve) => {
        const scroller = document.querySelector("table")?.parentElement;
        const stamps: number[] = [];
        const until = performance.now() + seconds * 1000;
        const tick = (now: number) => {
          stamps.push(now);
          if (drive === "keys") window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
          else if (scroller) scroller.scrollTop += 120;
          if (now < until) {
            requestAnimationFrame(tick);
            return;
          }
          const gaps = stamps.slice(1).map((stamp, index) => stamp - (stamps[index] ?? stamp));
          const sorted = [...gaps].sort((a, b) => a - b);
          const span = ((stamps.at(-1) ?? 0) - (stamps[0] ?? 0)) / 1000;
          resolve({
            frames: gaps.length,
            seconds: Number(span.toFixed(2)),
            fps: Number((gaps.length / span).toFixed(1)),
            p95FrameMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)),
            longestFrameMs: Number((sorted.at(-1) ?? 0).toFixed(1)),
            framesOver17Ms: gaps.filter((gap) => gap > 17).length,
            framesOver25Ms: gaps.filter((gap) => gap > 25).length,
            activeIndexAtEnd: Number(document.querySelector("table")?.dataset.activeIndex ?? -1),
          });
        };
        requestAnimationFrame(tick);
      }),
    { drive, seconds },
  );
}

test("frame rate while J is held and while scrolling, virtual against plain", async ({ page }) => {
  test.skip(!process.env.WORKLIST_FPS, "measurement run only, set WORKLIST_FPS=1");
  test.setTimeout(120_000);
  const cpuThrottle = Number(process.env.WORKLIST_CPU_THROTTLE ?? 1);
  if (cpuThrottle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  }
  const report: Record<string, unknown> = {
    userAgent: await page.evaluate(() => navigator.userAgent),
    cpuThrottle,
  };
  for (const mode of ["virtual", "plain"] as const) {
    const started = Date.now();
    await page.goto(`/spikes/worklist?mode=${mode}`);
    await expect(page.locator("#worklist-row-0")).toBeVisible({ timeout: 60_000 });
    const loadMs = Date.now() - started;
    const domRows = await bodyRows(page).count();
    await page.waitForTimeout(500);
    const keys = await measure(page, "keys", 3);
    await page.keyboard.press("Home");
    await page.waitForTimeout(300);
    const scroll = await measure(page, "scroll", 3);
    report[mode] = { loadMs, domRows, keys, scroll };
  }
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (process.env.WORKLIST_FPS_OUT) writeFileSync(process.env.WORKLIST_FPS_OUT, json);
});
