import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const viewer = `/projects/${p07}/slides/${a1}?task=${rt14}`;
const guided = `/tasks/${rt14}/guided?slide=${a1}`;

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

const minimap = (page: Page) => page.getByTestId("stage-minimap");

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

async function chooseAlways(page: Page) {
  await page.goto("/settings/layout");
  const choice = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Minimap" })
    .getByRole("radio", { name: "Always" });
  await choice.click();
  await expect(choice).toBeChecked();
}

async function wheel(page: Page, direction: "in" | "out", steps: number) {
  const stage = await ready(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, direction === "out" ? 400 : -400);
    await page.waitForTimeout(15);
  }
}

test("the viewer minimap is hidden at the whole slide and sits bottom right once zoomed in", async ({
  page,
}) => {
  await page.goto(viewer);
  await ready(page);
  await wheel(page, "out", 40);
  await expect(minimap(page)).toHaveCount(0);
  await wheel(page, "in", 30);
  await expect(minimap(page)).toBeVisible();
  await expect(minimap(page)).toHaveAttribute("data-corner", "bottom-right");
});

test("the viewer minimap reads the head and the foot of a task", async ({ page }) => {
  await page.goto(viewer);
  await ready(page);
  await wheel(page, "in", 30);
  await expect(minimap(page)).toBeVisible();
  await expect(minimap(page)).toContainText(/T\d+ of \d+/);
  await expect(minimap(page)).toContainText(/\d+× · \d+ of \d+ decided/);
  await chooseAlways(page);
  await page.goto(viewer);
  await ready(page);
  await expect(minimap(page)).toBeVisible();
  await expect(minimap(page)).toContainText("Whole slide");
  await expect(minimap(page)).toContainText(/\d+% seen/);
});

test("guided review shows the small inset with Click to move", async ({ page }) => {
  await page.goto(guided);
  await wheel(page, "in", 30);
  await expect(minimap(page)).toBeVisible({ timeout: 30_000 });
  await expect(minimap(page)).toContainText("Click to move");
  await expect(minimap(page)).toContainText("A1");
  await expect(minimap(page).locator('[data-slot="minimap-grip"]')).toBeVisible();
  const grip = await minimap(page).locator('[data-slot="minimap-grip"]').boundingBox();
  expect(grip?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(grip?.height ?? 0).toBeGreaterThanOrEqual(24);
});
