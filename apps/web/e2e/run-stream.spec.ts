import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const tiles = 12;
const cellsPerTile = 36;

async function openStreamingSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await page.waitForURL(/\/slides\//);
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}&workspace=annotate&scene=streaming`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  return page.getByTestId("run-stream");
}

const numberOf = async (panel: ReturnType<Page["getByTestId"]>, name: string) =>
  Number(await panel.getAttribute(name));

test("a whole-slide run streams objects before it ends, and cancel keeps them", async ({
  page,
}) => {
  const panel = await openStreamingSlide(page);
  await expect(panel).toHaveAttribute("data-phase", "idle");
  await page.getByTestId("run-stream-start").click();

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
  await expect(page.getByTestId("run-stream-start")).toBeVisible();
});
