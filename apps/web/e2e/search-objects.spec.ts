import type { Page } from "@playwright/test";
import { expect, test } from "./telemetry-capture.ts";

for (const typed of ["C1394", "A1 C1394", "A1/C1394", "s26-04812 a1 c1394"]) {
  test(`typing ${typed} into the search box lands on the cell in the viewer`, async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search everything" }).fill(typed);
    await page
      .getByRole("button", { name: /^C1394 on A1/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?.*object=C1394/);
  });
}

test("the suggested T2-C145 form finds the cell inside the region", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search everything" }).fill("T2-C145");
  await page
    .getByRole("button", { name: /^T2·C145 on A1/ })
    .first()
    .click();
  await expect(page).toHaveURL(/object=T2%C2%B7C145/);
});

test("an ID that does not exist finds no object", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search everything" }).fill("C99999");
  await expect(page.getByText('Nothing matches "C99999".')).toBeVisible();
});

async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  return palette;
}

test("the palette offers a cell by its ID from home and opens the viewer at it", async ({
  page,
}) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("C1394");
  const options = palette.getByRole("option");
  await expect(options.first()).toHaveAccessibleName(/^C1394 on A1/);
  await expect(options.last()).toHaveAccessibleName(/All results for "C1394"/);
  await options.first().click();
  await expect(page).toHaveURL(/\/slides\/[0-9a-f-]+\?.*object=C1394/);
});

test("on an open slide the palette offers the cell first and keeps the slide", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search everything" }).fill("T1·C145");
  await page
    .getByRole("button", { name: /^T1·C145 on A1/ })
    .first()
    .click();
  await expect(page).toHaveURL(/object=T1%C2%B7C145/);
  const slide = page.url().match(/\/slides\/([0-9a-f-]+)/)?.[1];
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("C1394");
  const options = palette.getByRole("option");
  await expect(options.first()).toHaveAccessibleName(/^C1394 on A1/);
  await options.first().click();
  await expect(page).toHaveURL(new RegExp(`/slides/${slide}\\?.*object=C1394`));
});
