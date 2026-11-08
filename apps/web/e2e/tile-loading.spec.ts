import { expect, test } from "@playwright/test";

const sampleProject = "00000000-0000-4000-8003-000000000001";
const tumor001 = "00000000-0000-4000-8005-000000000101";
const livePath = `/projects/${sampleProject}/slides/${tumor001}/live`;

test("a delayed tile server shows the loading hint after a second and the slow source after five", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      if (url.endsWith("/original.tif")) await new Promise((resolve) => setTimeout(resolve, 9000));
      return original(input, init);
    };
  });
  await page.goto(livePath);
  const stage = page.getByTestId("slide-stage");
  const hint = page.getByTestId("tile-hint");
  await expect(stage).toHaveAttribute("data-state", "loading", { timeout: 15_000 });
  await expect(hint).toHaveAttribute("data-kind", "opening", { timeout: 4000 });
  await expect(hint).toContainText("Loading the slide");
  const sawOpening = Date.now();
  await expect(hint).toHaveAttribute("data-kind", "slow", { timeout: 7000 });
  expect(Date.now() - sawOpening).toBeGreaterThanOrEqual(3000);
  await expect(hint).toContainText(/Slow source\. The slide storage answers in \d+\.\d s\./);
  await expect(hint.getByRole("button", { name: "Source status" })).toBeVisible();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(hint).toBeHidden({ timeout: 5000 });
});

test("the checker marks only the slide area and the canvas stays clear above it", async ({
  page,
}) => {
  await page.goto(livePath);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  const checker = page.getByTestId("slide-checker");
  await expect(checker).toBeVisible();
  const stageBox = await stage.boundingBox();
  const checkerBox = await checker.boundingBox();
  if (stageBox === null || checkerBox === null) throw new Error("Missing boxes");
  expect(checkerBox.x).toBeGreaterThanOrEqual(stageBox.x);
  expect(checkerBox.y).toBeGreaterThanOrEqual(stageBox.y);
  expect(checkerBox.x + checkerBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 0.5);
  expect(checkerBox.y + checkerBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 0.5);
  const canvasBackground = await page
    .getByTestId("slide-host")
    .locator("canvas")
    .evaluate((canvas) => getComputedStyle(canvas).backgroundColor);
  expect(canvasBackground).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

test("a tile that fails keeps a grey placeholder with Retry and loads after Retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { armed: true, spoiled: 0, reads: 0 };
    Object.assign(window, { tileFault: state });
    const post = Object.getOwnPropertyDescriptor(Worker.prototype, "postMessage")?.value as (
      this: Worker,
      ...args: unknown[]
    ) => void;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const read = message as { type?: string; region?: { backing: number } };
      if (read?.type === "read") {
        state.reads += 1;
        if (state.armed && read.region?.backing === 0) {
          state.armed = false;
          state.spoiled += 1;
          return post.call(this, { ...read, region: { ...read.region, backing: 99 } }, ...rest);
        }
      }
      return post.call(this, message, ...rest);
    };
  });
  await page.goto(livePath);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  const placeholders = page.getByTestId("tile-placeholder");
  await expect(placeholders).toHaveCount(1, { timeout: 10_000 });
  await expect(placeholders.first().getByRole("button", { name: "Retry" })).toBeVisible();
  const key = await placeholders.first().getAttribute("data-tile");
  const readsBefore = await page.evaluate(
    () => (window as unknown as { tileFault: { reads: number } }).tileFault.reads,
  );
  await placeholders.first().getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(`[data-tile="${key}"]`)).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const readsAfter = await page.evaluate(
    () => (window as unknown as { tileFault: { reads: number } }).tileFault.reads,
  );
  expect(readsAfter - readsBefore).toBe(1);
  await expect(placeholders).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-state", "ready");
});
