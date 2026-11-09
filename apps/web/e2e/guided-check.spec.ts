import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";

test.use({ viewport: { width: 1440, height: 900 } });

async function openTaskSlide(page: Page) {
  await page.goto(`/projects/${p07}/slides/${withResults}/live?task=${annotateTask}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(stage).toHaveAttribute("data-layer", "shared");
  await expect(page.getByTestId("ai-object")).toHaveCount(6);
  return stage;
}

const row = (page: Page, object: string) =>
  page.getByRole("button", { name: new RegExp(`^${object}`) });

test("a scoped slide is checked by keyboard in its stored order, leaving objects outside the scope, with fixes and one drawn miss", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stage = await openTaskSlide(page);
  const guide = page.getByTestId("guided-check");

  await page.keyboard.press("Shift+G");
  await expect(guide).toHaveAttribute("data-current", "C1");
  await expect(guide).toHaveAttribute("data-left", "5");

  await page.keyboard.press("d");
  await expect(row(page, "C1")).toHaveAttribute("data-origin", "ai-confirmed");
  await expect(guide).toHaveAttribute("data-current", "C2");

  await page.keyboard.press("Shift+Y");
  await expect(row(page, "C2")).toHaveAttribute("data-origin", "ai-edited");
  await expect(guide).toHaveAttribute("data-current", "C3");

  await page.keyboard.press("Shift+E");
  await expect(guide).toHaveAttribute("data-current", "C4");
  await page.keyboard.press("Shift+X");
  await expect(row(page, "C4")).toHaveAttribute("data-origin", "ai-edited");
  await expect(guide).toHaveAttribute("data-current", "C5");

  await page.keyboard.press("d");
  await expect(guide).toHaveAttribute("data-current", "C3");
  await page.keyboard.press("d");
  await expect(guide).toHaveAttribute("data-left", "0");
  await expect(page.getByTestId("guided-line")).toHaveText("Every AI object is checked.");
  await expect(row(page, "C6")).toHaveAttribute("data-origin", "ai");

  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of [
    [520, 250],
    [700, 270],
    [680, 420],
    [540, 400],
  ] as const) {
    await page.mouse.click(box.x + x, box.y + y);
  }
  await page.mouse.click(box.x + 522, box.y + 251);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await expect(page.locator('[data-testid="task-object"][data-origin="human"]')).toHaveCount(1);
});

test("a row click keeps the guided object and a fast second key does not touch another object", async ({
  page,
}) => {
  await openTaskSlide(page);
  const guide = page.getByTestId("guided-check");
  await page.keyboard.press("Shift+G");
  await expect(guide).toHaveAttribute("data-current", "C1");

  await row(page, "C4").click();
  await expect(guide).toHaveAttribute("data-current", "C1");
  await expect(row(page, "C1")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "C4")).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("d");
  await page.keyboard.press("Shift+X");
  await expect(guide).toHaveAttribute("data-current", "C5");
  await expect(row(page, "C1")).toHaveAttribute("data-origin", "ai-confirmed");
  await expect(row(page, "C5")).toHaveAttribute("data-origin", "ai");
});

test("the guide key does nothing while the AI result is hidden", async ({ page }) => {
  await openTaskSlide(page);
  await page.getByRole("switch", { name: "Show the AI result" }).click();
  await page.keyboard.press("Shift+G");
  await page.getByRole("switch", { name: "Show the AI result" }).click();
  await expect(page.getByTestId("guided-check")).toHaveCount(0);
});
