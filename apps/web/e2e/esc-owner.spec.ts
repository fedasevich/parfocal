import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";

async function openTaskSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}&workspace=annotate`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

const pins = (page: Page) => page.locator('[data-slot="comment-pin"]');
const vertices = (page: Page) => page.getByTestId("polygon-vertex");

test("Esc peels a comment, then the polygon draft, then the tool, one per press", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("c");
  await page.mouse.click(box.x + 600, box.y + 500);
  const composer = page.getByRole("textbox", { name: "Comment at the pin" });
  await expect(composer).toBeFocused();
  await composer.fill("Is this edge real?");
  await page.keyboard.press("Enter");
  await expect(pins(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");

  await page.keyboard.press("p");
  await expect(stage).toHaveAttribute("data-tool", "polygon");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.mouse.click(box.x + 280, box.y + 260);
  await expect(vertices(page)).toHaveCount(3);
  await pins(page).first().click();
  await expect(page.getByTestId("pin-thread")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pin-thread")).toHaveCount(0);
  await expect(vertices(page)).toHaveCount(3);
  await expect(stage).toHaveAttribute("data-tool", "polygon");

  await page.keyboard.press("Escape");
  await expect(vertices(page)).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "polygon");

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

test("Esc cancels a drag in flight before it leaves the tool", async ({ page }) => {
  test.setTimeout(60_000);
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 340, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});
