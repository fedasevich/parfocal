import { expect, type Page, test } from "@playwright/test";

const story = (id: string, theme: "dark" | "light" = "dark") =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`;

const idsOf = (page: Page) =>
  page.locator('#storybook-root tbody [data-kind="id"]').allTextContents();
const header = (page: Page, name: string) => page.getByRole("columnheader", { name });

test("a sorted column says its order and a click flips it", async ({ page }) => {
  await page.goto(story("components-table--sorting"));
  await expect(header(page, "Objects")).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("button", { name: "Objects (sorted high to low)" })).toBeVisible();
  await expect(header(page, "Slide")).toHaveAttribute("aria-sort", "none");
  expect(await idsOf(page)).toEqual(["S-0150", "S-0141", "S-0151", "S-0142"]);
  await page.getByRole("button", { name: /^Objects/ }).click();
  await expect(header(page, "Objects")).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByRole("button", { name: "Objects (sorted low to high)" })).toBeVisible();
  expect(await idsOf(page)).toEqual(["S-0142", "S-0151", "S-0141", "S-0150"]);
});

test("the keyboard sorts another column with Enter", async ({ page }) => {
  await page.goto(story("components-table--sorting"));
  await page.getByRole("button", { name: /^Slide/ }).focus();
  await page.keyboard.press("Enter");
  await expect(header(page, "Slide")).toHaveAttribute("aria-sort", "ascending");
  await expect(header(page, "Objects")).toHaveAttribute("aria-sort", "none");
  expect(await idsOf(page)).toEqual(["S-0141", "S-0142", "S-0150", "S-0151"]);
});

test("numbers use tabular figures on the right and IDs use monospace", async ({ page }) => {
  await page.goto(story("components-table--sorting"));
  const number = page.locator('#storybook-root tbody [data-kind="number"]').first();
  await expect(number).toHaveCSS("font-variant-numeric", "tabular-nums");
  await expect(number).toHaveCSS("text-align", "right");
  const id = page.locator('#storybook-root tbody [data-kind="id"]').first();
  expect(await id.evaluate((cell) => getComputedStyle(cell).fontFamily)).toMatch(/mono/i);
  await expect(header(page, "Stain")).toHaveCSS("font-size", "12px");
});

test("Tab reaches every row's checkbox and action, and Space picks a row", async ({ page }) => {
  await page.goto(story("components-table--selection"));
  const stops = [
    "Pick every row",
    "ID",
    "Slide",
    "Objects",
    "Pick Slide A1",
    "Open Slide A1",
    "Pick Slide A2",
    "Open Slide A2",
    "Pick Slide B1",
    "Open Slide B1",
    "Pick Slide B2",
    "Open Slide B2",
  ];
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (const stop of stops) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? "";
    });
    expect(name.startsWith(stop)).toBe(true);
  }
  await page.getByRole("checkbox", { name: "Pick Slide B1" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "Pick Slide B1" })).toBeChecked();
  await expect(page.getByTestId("table-status")).toHaveText("2 picked");
  await page.getByRole("button", { name: "Open Slide B2" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("table-status")).toContainText("opened S-0151");
});

test("the header checkbox shows some, picks every row and clears them", async ({ page }) => {
  await page.goto(story("components-table--selection"));
  const all = page.getByRole("checkbox", { name: "Pick every row" });
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  const row = page.locator("#storybook-root tbody tr").nth(1);
  await expect(row).toHaveAttribute("data-state", "selected");
  await expect(page.locator("#storybook-root tbody tr").first()).not.toHaveAttribute(
    "data-state",
    "selected",
  );
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('#storybook-root tbody tr[data-state="selected"]')).toHaveCount(4);
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("table-status")).toHaveText("No rows picked");
});

for (const theme of ["dark", "light"] as const) {
  test(`a picked row and a hovered row draw a different background in ${theme}`, async ({
    page,
  }) => {
    await page.goto(story("components-table--selection", theme));
    const rows = page.locator("#storybook-root tbody tr");
    const background = (index: number) =>
      rows.nth(index).evaluate((row) => getComputedStyle(row).backgroundColor);
    const plain = await background(2);
    expect(await background(1)).not.toEqual(plain);
    await rows.nth(2).hover();
    await expect.poll(() => background(2)).not.toEqual(plain);
  });
}

test("an empty table says why in one row across every column", async ({ page }) => {
  await page.goto(story("components-table--empty"));
  const empty = page.locator('#storybook-root [data-slot="table-empty"] td');
  await expect(empty).toHaveAttribute("colspan", "6");
  await expect(empty).toContainText("No slides in this project yet");
  await expect(page.getByRole("checkbox", { name: "Pick every row" })).toBeDisabled();
});
