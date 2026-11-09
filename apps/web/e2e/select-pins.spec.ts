import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";

async function openTaskSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await page.waitForURL(/\/slides\//);
  const stage = page.getByTestId("slide-stage");
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}&workspace=annotate`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

const pins = (page: Page) => page.locator('[data-slot="comment-pin"]');

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function placePin(page: Page, at: { x: number; y: number }, text: string) {
  await page.keyboard.press("c");
  await page.mouse.click(at.x, at.y);
  const composer = page.getByRole("textbox", { name: "Comment at the pin" });
  await expect(composer).toBeFocused();
  await composer.fill(text);
  await page.keyboard.press("Enter");
  await expect(pins(page)).toHaveCount(1);
}

async function pickByMarquee(page: Page, around: { x: number; y: number }) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.mouse.move(around.x - 60, around.y - 70);
  await page.mouse.down();
  await page.mouse.move(around.x + 60, around.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("select-pin")).toHaveCount(1);
}

test("the select tool picks a pin by marquee and drags it, and undo puts it back", async ({
  page,
}) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await placePin(page, { x: box.x + 600, y: box.y + 500 }, "Select me");
  const pin = pins(page).first();
  const before = await centre(pin);
  await pickByMarquee(page, before);
  await expect(page.getByTestId("select-layer")).toHaveAttribute(
    "data-selected-pins",
    /[0-9a-f-]{36}/,
  );
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + 30, { steps: 6 });
  await page.mouse.up();
  const moved = await centre(pin);
  expect(moved.x - before.x).toBeGreaterThan(80);
  expect(moved.x - before.x).toBeLessThan(100);
  await page.keyboard.press("Control+z");
  const restored = await centre(pin);
  expect(Math.abs(restored.x - before.x)).toBeLessThan(2);
});

test("Delete on a picked pin asks first, Cancel keeps it and Delete removes its thread", async ({
  page,
}) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await placePin(page, { x: box.x + 600, y: box.y + 500 }, "Remove me");
  await pickByMarquee(page, await centre(pins(page).first()));
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete 1 comment thread?");
  await expect(dialog).toContainText("This removes 1 comment thread");
  await dialog.getByRole("button", { name: /Cancel/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pins(page)).toHaveCount(1);
  await expect(page.getByTestId("select-pin")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await dialog.getByRole("button", { name: /^Delete/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pins(page)).toHaveCount(0);
  await expect(page.getByTestId("select-pin")).toHaveCount(0);
});
