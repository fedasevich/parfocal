import { expect, type Page, test } from "./a11y.ts";

async function openCompare(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const slides = page.getByRole("dialog", { name: "Slides in this case and task" });
  await slides
    .getByRole("button", { name: /Side by side with/ })
    .first()
    .click();
  await expect(page).toHaveURL(/scene=picked/);
}

const leftPane = (page: Page) => page.locator('[data-pane="left"]');
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

  await leftPane(page).getByTitle("Change the slide on this side").click();
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

  await page.getByRole("button", { name: "Change the right slide" }).click();
  await page
    .getByRole("listbox", { name: "Slide for the right side" })
    .getByRole("option", { name: /^A2/ })
    .click();
  await expect(rightPane(page)).toHaveAccessibleName(/^Right: A2/);

  await page.getByRole("button", { name: "Swap sides" }).click();
  await expect(leftPane(page)).toHaveAccessibleName(/^Left: A2/);
  await expect(rightPane(page)).toHaveAccessibleName(/^Right: A1/);
});
