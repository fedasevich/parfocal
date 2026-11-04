import { expect, test } from "@playwright/test";

test("the sidebar opens Search and an object ID opens the slide at the object", async ({
  page,
}) => {
  await page.goto("/my-work");
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByRole("textbox", { name: "Search everything" }).fill("T2·C145");
  const row = page.getByRole("button", { name: /T2·C145 on A1/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole("region", { name: "Object IDs" })).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?.*object=T2%C2%B7C145/);
});

test("part of a full path finds the object and the scopes narrow the groups", async ({ page }) => {
  await page.goto("/search?q=s26-04812%20c145");
  await expect(page.getByRole("region", { name: "Object IDs" })).toBeVisible();
  await page.getByRole("radio", { name: "Projects" }).click();
  await expect(page).toHaveURL(/scope=projects/);
  await expect(page.getByRole("region", { name: "Object IDs" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Object IDs" }).click();
  await page
    .getByRole("button", { name: /^T1·C145 on A1/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/slides\/.*object=T1/);
});

test("the palette All results row carries the query to the search page", async ({ page }) => {
  await page.goto("/");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  await palette.getByRole("combobox").fill("c145");
  await palette.getByRole("option", { name: /All results for "c145"/ }).click();
  await expect(page).toHaveURL(/\/search\?q=c145/);
  await expect(page.getByRole("textbox", { name: "Search everything" })).toHaveValue("c145");
  await expect(page.getByRole("region", { name: "Object IDs" })).toBeVisible();
});

test("the Actions scope lists matching actions", async ({ page }) => {
  await page.goto("/search?q=upload&scope=actions");
  await expect(page.getByRole("button", { name: /Upload slides and results/ })).toBeVisible();
});
