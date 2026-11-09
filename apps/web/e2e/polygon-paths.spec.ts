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
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  return { stage, box };
}

test("Enter closes a polygon of three vertices", async ({ page }) => {
  const { stage, box } = await openSlide(page);
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.mouse.click(box.x + 300, box.y + 320);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "3");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});

test("Enter with two vertices keeps drafting", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(2);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
});

test("Shift snaps the next vertex to a 45 degree direction", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.keyboard.up("Shift");
  await page.mouse.click(box.x + 300, box.y + 320);
  await page.keyboard.press("Enter");
  const shape = page.getByTestId("polygon-shape");
  const raw = (await shape.getAttribute("data-vertices")) ?? "";
  const v = raw.split(" ").map(Number);
  expect(Math.abs((v[3] ?? 0) - (v[1] ?? 0))).toBeLessThanOrEqual(1);
});

test("switching tool finishes a polygon of three vertices and drops a smaller one", async ({
  page,
}) => {
  const { stage, box } = await openSlide(page);
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.getByRole("button", { name: "Ruler" }).click();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await page.getByRole("button", { name: "Polygon" }).click();
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.mouse.click(box.x + 300, box.y + 320);
  await page.getByRole("button", { name: "Ruler" }).click();
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "3");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});
