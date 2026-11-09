import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

test("Shift L draws an arrow by dragging, undo removes it, redo restores it and a tap draws none", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("Shift+L");
  await expect(stage).toHaveAttribute("data-tool", "arrow");

  await page.mouse.click(box.x + 250, box.y + 250);
  await expect(page.getByTestId("arrow-shape")).toHaveCount(0);

  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230);
  await expect(page.getByTestId("arrow-draft")).toHaveCount(1);
  await page.mouse.move(box.x + 340, box.y + 260);
  await page.mouse.up();
  await expect(page.getByTestId("arrow-draft")).toHaveCount(0);
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);
});

test("T places text that Enter keeps and Escape drops, and undo restores each", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("t");
  await expect(stage).toHaveAttribute("data-tool", "text");
  const draft = page.getByTestId("text-draft");
  const shapes = page.getByTestId("text-shape");

  await page.mouse.click(box.x + 300, box.y + 200);
  await expect(draft).toBeFocused();
  await page.keyboard.type("tumor edge");
  await page.keyboard.press("Enter");
  await expect(draft).toHaveCount(0);
  await expect(shapes).toHaveCount(1);
  await expect(shapes.first()).toHaveText("tumor edge");
  await expect(stage).toHaveAttribute("data-tool", "text");

  await page.keyboard.press("Control+z");
  await expect(shapes).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(shapes).toHaveCount(1);

  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.type("not this one");
  await page.keyboard.press("Escape");
  await expect(draft).toHaveCount(0);
  await expect(shapes).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-tool", "text");

  await page.keyboard.press("Control+z");
  await expect(draft).toHaveValue("not this one");
  await expect(shapes).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(shapes).toHaveCount(2);

  await page.mouse.click(box.x + 400, box.y + 350);
  await page.keyboard.press("Enter");
  await expect(draft).toHaveCount(0);
  await expect(shapes).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});
