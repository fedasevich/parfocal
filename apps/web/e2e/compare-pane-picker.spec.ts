import { expect, type Page, test } from "./a11y.ts";
import { openCompare, openCompareOptions } from "./compare-open.ts";

const leftPane = (page: Page) => page.locator('[data-slot="compare-home"]');
const rightPane = (page: Page) => page.locator('[data-pane="right"]');

test("A2 goes next to A1 from a pane chip and swaps when picked on the other side", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await expect(leftPane(page)).toHaveAccessibleName(/^Left: A1/);

  await rightPane(page).getByTitle("Change the slide on this side").click();
  const list = page.getByRole("listbox", { name: "Slide for the right side" });
  await list.getByRole("option", { name: /^A2/ }).click();
  await expect(rightPane(page)).toHaveAccessibleName(/^Right: A2/);
  await expect(leftPane(page)).toHaveAccessibleName(/^Left: A1/);

  await leftPane(page).getByRole("button", { name: /^A1/ }).click();
  await page
    .getByRole("listbox", { name: "Slide for the left side" })
    .getByRole("option", { name: /^A2/ })
    .click();
  await expect(leftPane(page)).toHaveAccessibleName(/^Left: A2/);
  await expect(rightPane(page)).toHaveAccessibleName(/^Right: A1/);
});

test("A2 goes next to A1 from the inspector Change button and Swap sides swaps them", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await openCompareOptions(page);

  await page.getByRole("button", { name: "Change the right slide" }).click();
  await page
    .getByRole("listbox", { name: "Slide for the right side" })
    .getByRole("option", { name: /^A2/ })
    .click();
  await expect(rightPane(page)).toHaveAccessibleName(/^Right: A2/);

  await openCompareOptions(page);
  await page.getByRole("button", { name: "Swap sides" }).click();
  await expect(leftPane(page)).toHaveAccessibleName(/^Left: A2/);
  await expect(rightPane(page)).toHaveAccessibleName(/^Right: A1/);
});
