import { expect, type Page, test } from "./a11y.ts";
import { pickOutlineModel } from "./outline-model.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openBestSlow(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides&best=slow`);
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
  await pickOutlineModel(page, "Best");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const layer = (page: Page) => page.getByTestId("smart-layer");
const queuedMarks = (page: Page) => page.getByTestId("smart-queued");

test("clicks made while the model works are numbered, counted and sent together", async ({
  page,
}) => {
  test.slow();
  const encoderCalls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/embeddings/view")) {
      encoderCalls.push(request.url());
    }
  });
  const centre = await openBestSlow(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(layer(page)).toHaveAttribute("data-phase", "thinking");
  await expect(layer(page)).toHaveAttribute("data-queued", "0");

  await page.keyboard.down("Shift");
  for (const step of [1, 2, 3, 4, 5]) {
    await page.mouse.click(centre.x + step * 8, centre.y);
  }
  await page.keyboard.up("Shift");

  await expect(queuedMarks(page)).toHaveCount(5);
  for (const order of [1, 2, 3, 4, 5]) {
    await expect(queuedMarks(page).nth(order - 1)).toHaveAttribute("data-order", `${order}`);
    await expect(queuedMarks(page).nth(order - 1)).toHaveText(`${order}`);
  }
  await expect(layer(page)).toHaveAttribute("data-queued", "5");
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await expect(page.getByTestId("smart-status")).toHaveText(/, 5 queued$/);

  await page.keyboard.press("Backspace");
  await expect(queuedMarks(page)).toHaveCount(4);
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await expect(page.getByTestId("smart-status")).toHaveText(/, 4 queued$/);

  await expect(layer(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expect(layer(page)).toHaveAttribute("data-queued", "0");
  await expect(layer(page)).toHaveAttribute("data-points", "5");
  await expect(layer(page)).toHaveAttribute("data-requests", "2");
  await expect(queuedMarks(page)).toHaveCount(0);
  await expect(page.getByTestId("proposal-layer")).toHaveAttribute("data-proposals", "1");
  expect(encoderCalls).toHaveLength(2);
});

test("Escape clears the queue and keeps the point being outlined", async ({ page }) => {
  test.slow();
  const centre = await openBestSlow(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(layer(page)).toHaveAttribute("data-phase", "thinking");
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 8, centre.y);
  await page.mouse.click(centre.x + 16, centre.y);
  await page.keyboard.up("Shift");
  await expect(queuedMarks(page)).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(queuedMarks(page)).toHaveCount(0);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-tool", "smart");
  await expect(layer(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await expect(layer(page)).toHaveAttribute("data-requests", "1");
});

test("Undo takes back the last queued click before anything already sent", async ({ page }) => {
  test.slow();
  const centre = await openBestSlow(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(layer(page)).toHaveAttribute("data-phase", "thinking");
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 8, centre.y);
  await page.mouse.click(centre.x + 16, centre.y);
  await page.keyboard.up("Shift");
  await expect(queuedMarks(page)).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(queuedMarks(page)).toHaveCount(1);
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await expect(layer(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expect(layer(page)).toHaveAttribute("data-points", "2");
});
