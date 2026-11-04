import { expect, type Page, test } from "@playwright/test";

const story = (id: string) =>
  `/iframe.html?id=components-gallery-tile--${id}&viewMode=story&globals=a11y.manual:!true`;
const tiles = (page: Page) => page.locator('[data-slot="gallery-tile"]');

test("a tile to check shows the dashed ring, the AI wording and no decision dot at both sizes", async ({
  page,
}) => {
  await page.goto(story("to-check"));
  const all = tiles(page);
  await expect(all).toHaveCount(2);
  for (const [index, size] of [92, 120].entries()) {
    const tile = all.nth(index);
    await expect(tile).toHaveAttribute("data-state", "to-check");
    await expect(tile).toHaveAttribute("aria-pressed", "false");
    const box = await tile.locator('[data-slot="gallery-tile-image"]').boundingBox();
    expect(box?.width).toBe(size);
    expect(box?.height).toBe(size);
    await expect(tile.locator('[data-slot="gallery-tile-ring"]')).toHaveCSS(
      "border-top-style",
      "dashed",
    );
    await expect(tile.locator('[data-slot="gallery-tile-label"]')).toHaveText("probably tumor");
    await expect(tile.locator('[data-slot="gallery-tile-dot"]')).toBeHidden();
  }
  await expect(
    page.getByRole("button", { name: "T1·C145 probably tumor, to check" }),
  ).toBeVisible();
});

test("the current tile is pressed and draws the accent ring", async ({ page }) => {
  await page.goto(story("current"));
  const tile = tiles(page).first();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "T1·C145 tumor or immune, current" }),
  ).toBeVisible();
  const shadow = await tile
    .locator("> span")
    .first()
    .evaluate((node) => getComputedStyle(node).boxShadow);
  expect(shadow).toContain("0px 0px 0px 4px");
  await expect(tile.locator('[data-slot="gallery-tile-dot"]')).toBeVisible();
});

test("a done tile fades the crop and shows the decision dot", async ({ page }) => {
  await page.goto(story("done"));
  const tile = tiles(page).first();
  await expect(tile).toHaveAttribute("data-state", "done");
  await expect(tile.locator('[data-slot="gallery-tile-image"]')).toHaveCSS("opacity", "0.4");
  await expect(tile.locator('[data-slot="gallery-tile-dot"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "T1·C145 tumor 82%, agree" })).toBeVisible();
});

test("a tile that may not be a nucleus shows the X action and the X marks it disagree", async ({
  page,
}) => {
  await page.goto(story("may-not-be-a-nucleus"));
  await expect(tiles(page)).toHaveCount(3);
  await expect(page.locator('[data-slot="gallery-tile-flag-action"]')).toHaveCount(2);
  await expect(page.locator('[data-slot="gallery-tile"][data-flag]')).toHaveCount(2);
  const first = page.getByRole("button", { name: "T1·C170 may not be a nucleus, disagree" });
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.locator('[data-slot="gallery-tile"][data-decision="disagree"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="gallery-tile-flag-action"]')).toHaveCount(2);
});

test("each decision has its own dot colour", async ({ page }) => {
  await page.goto(story("done-each-decision"));
  await expect(tiles(page)).toHaveCount(3);
  const colours = await tiles(page)
    .locator('[data-slot="gallery-tile-dot"]')
    .evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).backgroundColor));
  expect(new Set(colours).size).toBe(3);
});

test("a click makes a tile current, a decision marks it done, and the keyboard focus ring shows", async ({
  page,
}) => {
  await page.goto(story("pick-and-decide"));
  const second = page.getByRole("button", { name: /^T1·C161/ });
  await second.click();
  await expect(second).toHaveAttribute("data-state", "current");
  await page.getByRole("button", { name: "Agree" }).click();
  await expect(second).toHaveAttribute("data-state", "done");
  await expect(second).toHaveAccessibleName("T1·C161 tumor or immune, agree");
  await expect(page.getByRole("button", { name: /^T1·C160/ })).toHaveAttribute(
    "data-state",
    "current",
  );
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  const focused = page.locator('[data-slot="gallery-tile"]:focus-visible');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveCSS("outline-style", "solid");
  await expect(focused).toHaveCSS("outline-width", "2px");
});
