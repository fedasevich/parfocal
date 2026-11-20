import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function clickBest(page: Page, scene: string) {
  await page.goto(`/projects/${p07}?tab=slides&best=${scene}`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("s");
  await expect(stage).toHaveAttribute("data-tool", "smart");
  const choice = page.getByRole("group", { name: "Model for outlining nuclei" });
  await choice.getByRole("button", { name: "Best" }).click();
  await expect(choice).toHaveAttribute("data-tier", "best");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(centre.x, centre.y);
  return centre;
}

const layer = (page: Page) => page.getByTestId("smart-layer");
const wait = (page: Page) => page.getByTestId("gpu-wait");
const fallback = (page: Page) => page.getByTestId("smart-encoder-fallback");

test("a slow Best shows the GPU wait and then outlines with the server embedding", async ({
  page,
}) => {
  test.slow();
  await clickBest(page, "slow");
  await expect(wait(page)).toBeVisible();
  await expect(wait(page)).toHaveAttribute("data-kinds", "encoder");
  await expect(layer(page)).toHaveAttribute("data-phase", "thinking");
  await expect(layer(page)).toHaveAttribute("data-phase", "ready", { timeout: 15_000 });
  await expect(layer(page)).toHaveAttribute("data-encoder", "server");
  await expect(page.getByTestId("proposal-layer")).toHaveAttribute("data-proposals", "1");
  await expect(wait(page)).toHaveCount(0);
  await expect(fallback(page)).toHaveCount(0);
});

test("a refused Best says so and Good outlines the click", async ({ page }) => {
  await clickBest(page, "refuse");
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
  await expect(fallback(page)).toHaveAttribute("data-reason", "refused");
  await expect(fallback(page)).toHaveText("The server refused Best here, Good outlined this view");
  await expect(page.getByTestId("proposal-layer")).toHaveAttribute("data-proposals", "1");
  await expect(wait(page)).toHaveCount(0);
});

test("an offline Best GPU says so and the next click asks Best again", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/embeddings/view")) {
      asked.push(request.url());
    }
  });
  const centre = await clickBest(page, "offline");
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
  await expect(fallback(page)).toHaveAttribute("data-reason", "offline");
  await expect(fallback(page)).toContainText("Click again to ask Best again");
  const before = asked.length;
  await page.keyboard.press("Escape");
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(() => asked.length).toBeGreaterThan(before);
});

test("cancelling the GPU wait lets Good outline and says the wait was stopped", async ({
  page,
}) => {
  test.slow();
  await clickBest(page, "slow");
  await expect(wait(page)).toBeVisible();
  await page.getByTestId("gpu-wait-cancel").click();
  await expect(fallback(page)).toHaveAttribute("data-reason", "cancelled");
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
  await expect(wait(page)).toHaveCount(0);
});
