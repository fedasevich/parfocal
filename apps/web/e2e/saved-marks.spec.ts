import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const slideReady = 25_000;

test.describe.configure({ timeout: 60_000 });

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: slideReady });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

const stored = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("parfocal.fake.annotations") ?? "");

const rulerLabels = (page: Page) => page.getByTestId("ruler-layer").locator("text");

test("a ruler, an arrow and an edited text note are saved and still there after a reload", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  const arrows = page.getByTestId("arrow-shape");
  const texts = page.getByTestId("text-shape");

  await page.keyboard.press("l");
  await expect(stage).toHaveAttribute("data-tool", "ruler");
  await drag(page, { x: box.x + 200, y: box.y + 300 }, { x: box.x + 420, y: box.y + 304 });
  await expect(rulerLabels(page)).toHaveCount(1);
  const length = await rulerLabels(page).first().textContent();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+L");
  await expect(stage).toHaveAttribute("data-tool", "arrow");
  await drag(page, { x: box.x + 200, y: box.y + 150 }, { x: box.x + 340, y: box.y + 210 });
  await expect(arrows).toHaveCount(1);

  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await expect(stage).toHaveAttribute("data-tool", "text");
  await page.mouse.click(box.x + 480, box.y + 160);
  await page.keyboard.type("tumor edge");
  await page.keyboard.press("Enter");
  await expect(texts).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await expect.poll(() => stored(page)).toContain('"text":"tumor edge"');
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.mouse.dblclick(box.x + 484, box.y + 160);
  const draft = page.getByTestId("text-draft");
  await expect(draft).toHaveValue("tumor edge");
  await draft.fill("tumor margin");
  await page.keyboard.press("Enter");
  await expect(texts.first()).toHaveText("tumor margin");
  await expect.poll(() => stored(page)).toContain('"text":"tumor margin"');
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const saved = await stored(page);
  expect(saved).toContain('"kind":"arrow"');
  expect(saved).toContain('"kind":"measurement"');

  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: slideReady });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(arrows).toHaveCount(1);
  await expect(texts).toHaveCount(1);
  await expect(texts.first()).toHaveText("tumor margin");
  await expect(rulerLabels(page)).toHaveCount(1);
  await expect(rulerLabels(page).first()).toHaveText(length ?? "");
});
