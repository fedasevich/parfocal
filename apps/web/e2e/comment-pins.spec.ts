import { expect, type Locator, type Page, test } from "@playwright/test";

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

async function drawRectangle(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 340, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
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
}

test("C places a pin, Shift+Enter adds a line and Enter posts", async ({ page }) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("c");
  await expect(stage).toHaveAttribute("data-tool", "comment");
  await page.mouse.click(box.x + 500, box.y + 450);
  const composer = page.getByRole("textbox", { name: "Comment at the pin" });
  await expect(composer).toBeFocused();
  await expect(pins(page)).toHaveCount(0);
  await page.keyboard.type("First line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  await expect(composer).toHaveValue("First line\nSecond line");
  await expect(pins(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(pins(page)).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toHaveCount(0);
  await expect(pins(page).first()).toHaveAttribute("title", "First line");
  await expect(pins(page).first()).toHaveAttribute("data-linked", "");
});

test("Escape closes the composer first and then leaves the tool", async ({ page }) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("c");
  await page.mouse.click(box.x + 500, box.y + 450);
  await expect(page.getByTestId("pin-composer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pin-composer")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "comment");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await expect(pins(page)).toHaveCount(0);
});

test("dragging a pin moves it and undo puts it back", async ({ page }) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await placePin(page, { x: box.x + 600, y: box.y + 500 }, "Check this edge");
  const pin = pins(page).first();
  await expect(pin).toBeVisible();
  const before = await centre(pin);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 80, before.y - 40, { steps: 6 });
  await page.mouse.up();
  const moved = await centre(pin);
  expect(moved.x - before.x).toBeGreaterThan(70);
  expect(moved.x - before.x).toBeLessThan(90);
  expect(before.y - moved.y).toBeGreaterThan(30);
  await page.keyboard.press("Control+z");
  const restored = await centre(pin);
  expect(Math.abs(restored.x - before.x)).toBeLessThan(2);
  expect(Math.abs(restored.y - before.y)).toBeLessThan(2);
  await page.keyboard.press("Control+Shift+z");
  const again = await centre(pin);
  expect(Math.abs(again.x - moved.x)).toBeLessThan(2);
});

test("a pin placed on a shape follows the shape when it moves", async ({ page }) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await placePin(page, { x: box.x + 300, y: box.y + 270 }, "Inside the outline");
  const pin = pins(page).first();
  await expect(pin).toBeVisible();
  await expect(pin).not.toHaveAttribute("data-linked", "");
  const before = await centre(pin);
  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 270);
  await page.mouse.move(box.x + 250, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 360, { steps: 6 });
  await page.mouse.up();
  const after = await centre(pin);
  expect(after.x - before.x).toBeGreaterThan(70);
  expect(after.x - before.x).toBeLessThan(90);
  expect(after.y - before.y).toBeGreaterThan(50);
  expect(after.y - before.y).toBeLessThan(70);
});

const thread = (page: Page) => page.getByTestId("pin-thread");

test("clicking a pin opens its thread, a reply joins it and Escape closes it", async ({ page }) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await placePin(page, { x: box.x + 600, y: box.y + 500 }, "Is this edge real?");
  await expect(pins(page)).toHaveCount(1);
  await pins(page).first().click();
  await expect(thread(page)).toBeVisible();
  await expect(thread(page).getByRole("heading", { name: "Is this edge real?" })).toBeVisible();
  await expect(thread(page).locator('[data-slot="comment"]')).toHaveCount(1);
  await expect(thread(page).locator('[data-slot="comment"]').first()).toContainText("just now");
  const reply = thread(page).getByRole("textbox", { name: "Reply to this thread" });
  await expect(reply).toBeFocused();
  await reply.fill("Yes, it follows the fold");
  await page.keyboard.press("Enter");
  await expect(thread(page).locator('[data-slot="comment"]')).toHaveCount(2);
  await expect(reply).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(thread(page)).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "comment");
});

test("a pin on a shape embeds the shape's measurement in its thread", async ({ page }) => {
  test.setTimeout(60_000);
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await placePin(page, { x: box.x + 300, y: box.y + 270 }, "Inside the outline");
  await pins(page).first().click();
  const embed = thread(page).locator('[data-slot="thread-measurement"]');
  await expect(embed).toContainText("Area");
  await expect(embed).toContainText("Perimeter");
});

test("Resolve closes the thread and takes its pin off the slide", async ({ page }) => {
  const stage = await openTaskSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await placePin(page, { x: box.x + 600, y: box.y + 500 }, "Settled already");
  await pins(page).first().click();
  await thread(page).getByRole("button", { name: "Resolve" }).click();
  await expect(thread(page)).toHaveCount(0);
  await expect(pins(page)).toHaveCount(0);
});

test("a pin goes on a slide opened outside any task and its thread takes replies", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("task")).toBeNull();
  const posted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/threads") &&
      new URL(request.url()).pathname.startsWith(`/api/projects/${p07}/slides/`),
  );
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await placePin(page, { x: box.x + 500, y: box.y + 450 }, "Before any task");
  await posted;
  await expect(pins(page)).toHaveCount(1);
  await pins(page).first().click();
  const thread = page.getByTestId("pin-thread");
  await expect(thread).toContainText("Before any task");
  await thread.getByRole("textbox").fill("Seen it too");
  await page.keyboard.press("Enter");
  await expect(thread).toContainText("Seen it too");
});
