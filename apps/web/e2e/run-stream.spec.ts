import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const tiles = 12;
const cellsPerTile = 36;

async function openStreamingSlide(page: Page): Promise<string> {
  await page.goto(
    `/projects/${p07}/slides/${tumor044}?mode=annotate&run=streaming&tab=objects&as=DH`,
  );
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.getByText("tumor_044").first()).toBeVisible();
  return tumor044;
}

async function startWholeSlideRun(page: Page): Promise<void> {
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/projects/${p07}/model-runs`),
  );
  await page.getByTestId("start-run-find").click();
  expect((await started).status()).toBe(201);
}

const numberOf = async (panel: Locator, name: string) => Number(await panel.getAttribute(name));

test("a whole-slide run streams objects before it ends, and cancel keeps them", async ({
  page,
}) => {
  await openStreamingSlide(page);
  const panel = page.getByTestId("run-stream");
  await expect(panel).toHaveCount(0);

  await startWholeSlideRun(page);
  await expect(panel).toHaveAttribute("data-status", "running", { timeout: 15_000 });
  await expect.poll(() => numberOf(panel, "data-drawn"), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await numberOf(panel, "data-done")).toBeLessThan(tiles);
  await expect(page.getByTestId("run-stream-status")).toContainText("tiles");

  await page.getByTestId("run-stream-cancel").click();
  await expect(panel).toHaveAttribute("data-status", "cancelled", { timeout: 15_000 });
  await expect(panel).toHaveAttribute("data-phase", "ended");

  const done = await numberOf(panel, "data-done");
  const drawn = await numberOf(panel, "data-drawn");
  expect(done).toBeGreaterThan(0);
  expect(done).toBeLessThan(tiles);
  expect(drawn).toBe(done * cellsPerTile);
  await expect(page.getByTestId("run-stream-status")).toContainText("Kept");

  await page.waitForTimeout(2000);
  expect(await numberOf(panel, "data-drawn")).toBe(drawn);
  await expect(page.getByTestId("run-stream-cancel")).toHaveCount(0);
});

test("a run starts from the app, cancels and reloads", async ({ page }) => {
  await openStreamingSlide(page);
  const panel = page.getByTestId("run-stream");
  await expect(panel).toHaveCount(0);

  await page.getByTestId("start-run-find").click();
  await expect(panel).toHaveAttribute("data-status", "running", { timeout: 20_000 });
  await expect.poll(() => numberOf(panel, "data-drawn"), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("start-run")).toHaveCount(0);
  await expect
    .poll(() => numberOf(page.getByTestId("run-tiles-map"), "data-tiles"), { timeout: 15_000 })
    .toBeGreaterThan(0);

  await page.getByTestId("run-stream-cancel").click();
  await expect(panel).toHaveAttribute("data-status", "cancelled", { timeout: 15_000 });
  const drawn = await numberOf(panel, "data-drawn");
  expect(drawn).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(panel).toHaveCount(0);
  await page.getByTestId("start-run-load").click();
  await expect(panel).toHaveAttribute("data-phase", "ended", { timeout: 20_000 });
  await expect.poll(() => numberOf(panel, "data-drawn")).toBe(drawn);
});

test("an annotate slide with no run shows no run panel", async ({ page }) => {
  await openStreamingSlide(page);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("run-stream")).toHaveCount(0);
});
