import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSmart(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
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
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const layer = (page: Page) => page.getByTestId("smart-layer");

async function hoverUntilOutlined(page: Page, centre: { x: number; y: number }) {
  await expect(async () => {
    await page.mouse.move(centre.x + 1, centre.y);
    await page.mouse.move(centre.x, centre.y);
    await expect(layer(page)).toHaveAttribute("data-hover", "1", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test("moving the pointer over a warmed view draws a dashed outline and leaving removes it", async ({
  page,
}) => {
  const centre = await openSmart(page);
  await hoverUntilOutlined(page, centre);
  await expect(page.getByTestId("smart-hover")).toHaveAttribute("stroke-dasharray", "4 3");
  await page.mouse.move(centre.x, centre.y - 400);
  await page.mouse.move(-5, -5);
  await expect(layer(page)).toHaveAttribute("data-hover", "0");
});

test("a click on the previewed spot becomes the live object and the preview goes away", async ({
  page,
}) => {
  const centre = await openSmart(page);
  await hoverUntilOutlined(page, centre);
  await page.mouse.click(centre.x, centre.y);
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
  await expect(layer(page)).toHaveAttribute("data-live", "1");
  await expect(layer(page)).toHaveAttribute("data-hover", "0");
});

test("the toggle turns the preview off and the choice survives a reload", async ({ page }) => {
  const centre = await openSmart(page);
  await hoverUntilOutlined(page, centre);
  const toggle = page.getByTestId("smart-hover-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(layer(page)).toHaveAttribute("data-hover", "0");
  await page.mouse.move(centre.x + 2, centre.y);
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(300);
  await expect(layer(page)).toHaveAttribute("data-hover", "0");
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await page.keyboard.press("s");
  await expect(page.getByTestId("smart-hover-toggle")).toHaveAttribute("aria-pressed", "false");
});
