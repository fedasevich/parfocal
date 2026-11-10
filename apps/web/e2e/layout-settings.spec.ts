import { expect, type Page, test } from "./a11y.ts";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });
const group = (page: Page, name: string) => dialog(page).getByRole("radiogroup", { name });
const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });

async function openViewer(page: Page) {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true })
    .click();
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

test("the side panel width chosen in Settings sets the width on the slide", async ({ page }) => {
  await page.goto("/settings/layout");
  await group(page, "Side panel width").getByRole("radio", { name: "Wide" }).click();
  await expect(group(page, "Side panel width").getByRole("radio", { name: "Wide" })).toBeChecked();
  await page.reload();
  await openViewer(page);
  await expect(panel(page)).toBeVisible();
  expect(Math.round((await panel(page).boundingBox())?.width ?? 0)).toBe(420);
});

test("hiding the panel in Settings leaves the floating tab on the slide", async ({ page }) => {
  await page.goto("/settings/layout");
  const hide = dialog(page).getByRole("switch", { name: "Hide the panel" });
  await hide.click();
  await expect(hide).toBeChecked();
  await page.reload();
  await openViewer(page);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId("inspector-tab")).toHaveAccessibleName(
    /^Show the side panel, Objects( \d+)?$/,
  );
});

test("Hide while panning on the slide is the Panel while moving setting", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("checkbox", { name: "Hide while panning" }).click();
  await expect(page.getByRole("checkbox", { name: "Hide while panning" })).toBeChecked();
  await page.reload();
  await page.goto("/settings/layout");
  await expect(
    group(page, "Panel while moving").getByRole("radio", { name: "Hides while panning" }),
  ).toBeChecked();
  const stays = group(page, "Panel while moving").getByRole("radio", { name: "Stays put" });
  await stays.click();
  await expect(stays).toBeChecked();
  await page.reload();
  await openViewer(page);
  await expect(page.getByRole("checkbox", { name: "Hide while panning" })).not.toBeChecked();
});

test("the pinned slide strip is off by default and stays on after a reload", async ({ page }) => {
  await page.goto("/settings/layout");
  const strip = dialog(page).getByRole("switch", { name: "Pinned slide strip" });
  await expect(strip).not.toBeChecked();
  await strip.click();
  await expect(strip).toBeChecked();
  await page.reload();
  await expect(dialog(page).getByRole("switch", { name: "Pinned slide strip" })).toBeChecked();
});

test("the minimap mode chosen in Settings is still chosen after a reload", async ({ page }) => {
  await page.goto("/settings/layout");
  const never = group(page, "Minimap").getByRole("radio", { name: "Never" });
  await never.click();
  await expect(never).toBeChecked();
  await page.reload();
  await expect(group(page, "Minimap").getByRole("radio", { name: "Never" })).toBeChecked();
});
