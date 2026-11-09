import { expect, type Page, test } from "./a11y.ts";

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

test("cells are answered with the mouse only on the slide", async ({ page }) => {
  await page.goto(await fullViewerUrl(page, "T1·C145"));
  await expect(bar(page)).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Side panel" }).getByRole("group", {
      name: /^Your answer on T1·C145/,
    }),
  ).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: /Immune/ })).toHaveAttribute(
    "title",
    /neutrophils and eosinophils/,
  );
  const first = objectInUrl(page);
  await bar(page)
    .getByRole("button", { name: /Stroma/ })
    .click();
  await expect(page.getByText(`${first}: disagree`)).toBeVisible();
  const stage = await page.locator('[data-slot="slide-still"]').boundingBox();
  const box = await bar(page).boundingBox();
  expect(stage && box).toBeTruthy();
  if (!stage || !box) return;
  expect(box.y).toBeGreaterThan(stage.y);
});

test("cells are answered with the keyboard only on the slide", async ({ page }) => {
  await page.goto(await fullViewerUrl(page, "T1·C145"));
  await expect(bar(page)).toBeVisible();
  const first = objectInUrl(page);
  await page.keyboard.press("3");
  await expect(page.getByText(new RegExp(`${first}: (agree|disagree)`))).toBeVisible();
  const before = objectInUrl(page);
  for (const arrow of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await page.keyboard.press(arrow);
    if (objectInUrl(page) !== before) break;
  }
  await expect.poll(() => objectInUrl(page)).not.toBe(before);
  await page.keyboard.press("x");
  await expect(page.getByText(/: disagree$/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
});

type Box = { x: number; y: number; width: number; height: number };

const near = (spot: { x: number; y: number }, box: Box) =>
  spot.x > box.x - 8 &&
  spot.x < box.x + box.width + 8 &&
  spot.y > box.y - 8 &&
  spot.y < box.y + box.height + 8;

test("a click on a neighbouring cell on the slide selects it", async ({ page }) => {
  await page.goto(await fullViewerUrl(page, "T1·C145"));
  await expect(bar(page)).toBeVisible();
  const first = objectInUrl(page);
  const stage = await page.locator('[data-slot="slide-still"]').boundingBox();
  const barBox = await bar(page).boundingBox();
  if (!stage || !barBox) throw new Error("the slide or the bar has no box");
  const spots = await page.locator("[data-slot=slide-still] g[data-object]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        object: node.getAttribute("data-object") ?? "",
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }),
  );
  const neighbour = spots.find(
    (spot) => spot.object !== first && near(spot, stage) && !near(spot, barBox),
  );
  expect(neighbour).toBeTruthy();
  if (!neighbour) return;
  await page.mouse.click(neighbour.x, neighbour.y);
  await expect.poll(() => objectInUrl(page)).toBe(neighbour.object);
});

test("a comment pin drops on a cell with the comment tool on", async ({ page }) => {
  const url = await fullViewerUrl(page, "T1·C145");
  await page.goto(`${url}&tool=comment`);
  const stage = page.locator('[data-slot="slide-still"]');
  await expect(stage).toBeVisible();
  const box = await stage.boundingBox();
  if (!box) throw new Error("the slide has no box");
  const first = objectInUrl(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("pinned-thread")).toBeVisible();
  await expect(page.locator("[data-slot=comment-pin]")).toBeVisible();
  expect(objectInUrl(page)).not.toBe(first);
});

test("a signed off slide shows the type bar disabled with the reason", async ({ page }) => {
  const url = await fullViewerUrl(page, "T1·C145");
  await page.goto(`${url}&scene=signedoff`);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute("title", "Signed off. Ask the researcher to amend.");
  await expect(bar(page).getByRole("button", { name: /Keep/ })).toBeDisabled();
});
