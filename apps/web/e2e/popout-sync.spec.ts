import { expect, type Locator, type Page, test } from "./a11y.ts";

const minimap = (page: Page) => page.locator('[data-slot="smart-minimap"]');
const viewportOf = (page: Page) => minimap(page).locator('[data-slot="map-viewport"]');

async function openScene(page: Page, name: string) {
  await page.goto("/prototype");
  const link = page.getByRole("list", { name: "Screens" }).getByRole("link", { name, exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

async function settledBox(target: Locator) {
  let previous = await target.boundingBox();
  await expect
    .poll(async () => {
      const now = await target.boundingBox();
      const same = JSON.stringify(now) === JSON.stringify(previous);
      previous = now;
      return same;
    })
    .toBe(true);
  if (previous === null) throw new Error("the viewport rectangle has no box");
  return previous;
}

async function drag(page: Page, target: Locator) {
  const box = await settledBox(target);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 16, { steps: 4 });
  await page.mouse.up();
  return box;
}

test("the second window follows the main camera and moves it back", async ({ context }) => {
  const main = await context.newPage();
  await openScene(main, "Full viewer, one object · An open region, T5");
  const second = await context.newPage();
  await second.goto("/popout");
  await expect(second.getByTestId("popout-status")).toHaveAttribute("data-following", "true");
  await expect(viewportOf(second)).toBeVisible();

  const mainBefore = await settledBox(viewportOf(main));
  const secondBefore = await drag(second, viewportOf(second));
  await expect.poll(async () => (await viewportOf(main).boundingBox())?.x).not.toBe(mainBefore.x);
  await expect
    .poll(async () => (await viewportOf(second).boundingBox())?.x)
    .not.toBe(secondBefore.x);

  const secondMid = await settledBox(viewportOf(second));
  await drag(main, viewportOf(main));
  await expect.poll(async () => (await viewportOf(second).boundingBox())?.x).not.toBe(secondMid.x);
});

test("an object selected in the side panel window is selected in the main window", async ({
  page,
}) => {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  const opened = page.context().waitForEvent("page");
  await page.getByTestId("inspector-popout").click();
  const second = await opened;
  const panel = second.getByRole("complementary", { name: "Side panel" });
  await panel.getByRole("button", { name: /^T5 Tumor region/ }).click();
  await expect(page).toHaveURL(/object=T5/);
  await page.getByRole("button", { name: "Whole slide", exact: true }).click();
  await expect(page).not.toHaveURL(/object=/);
  await expect(second).not.toHaveURL(/object=/);
  await panel.getByRole("tab", { name: /^Comments/ }).click();
  await expect(page).toHaveURL(/tab=comments/);
});
