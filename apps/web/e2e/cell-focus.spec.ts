import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1280, height: 900 } });

async function fullViewerUrl(page: Page, object: string) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = (await link.getAttribute("href")) ?? "";
  const url = new URL(href, "http://localhost");
  return `${url.pathname}?task=${rt14}&object=${encodeURIComponent(object)}`;
}

const bar = (page: Page) => page.getByTestId("cell-type-bar");
const objectInUrl = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("object") ?? "");

test("a zone is reviewed by keyboard only in focus mode and the bar never covers the cell", async ({
  page,
}) => {
  await page.goto(await fullViewerUrl(page, "T1·C145"));
  await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cell-focus")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Side panel" })).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("cell-locator")).toHaveAttribute("data-size", "pip");

  const stage = await page.locator('[data-slot="slide-still"]').boundingBox();
  const box = await bar(page).boundingBox();
  expect(stage && box).toBeTruthy();
  if (!stage || !box) return;
  const centre = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  const nearestX = Math.min(Math.max(centre.x, box.x), box.x + box.width);
  const nearestY = Math.min(Math.max(centre.y, box.y), box.y + box.height);
  expect(Math.hypot(centre.x - nearestX, centre.y - nearestY)).toBeGreaterThan(24);

  const first = objectInUrl(page);
  await page.keyboard.press("k");
  await expect.poll(() => objectInUrl(page)).not.toBe(first);

  const second = objectInUrl(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  expect(objectInUrl(page)).toContain("·");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cell-focus")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
  expect(objectInUrl(page)).toContain("·");
  expect(second).toContain("·");
});

test("Enter in focus mode goes back and the type bar buttons decide with the mouse", async ({
  page,
}) => {
  await page.goto(await fullViewerUrl(page, "T1·C145"));
  await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cell-focus")).toBeVisible();
  const first = objectInUrl(page);
  await bar(page).getByRole("button").first().click();
  await expect.poll(() => objectInUrl(page)).not.toBe(first);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cell-focus")).toHaveCount(0);
});
