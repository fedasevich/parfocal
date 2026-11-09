import { expect, test } from "./a11y.ts";

const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Settings" });

test("the AI section shows a live example, the locked cutoff, the tier and the inspector blocks", async ({
  page,
}) => {
  await page.goto("/settings/ai");
  const ai = dialog(page);
  await expect(ai.getByText("Decision cutoff").first()).toBeVisible();
  await expect(ai.locator("[data-locked]").first()).toContainText("Set by your lab");
  await expect(ai.getByRole("radiogroup", { name: "Outline model tier" })).toBeVisible();
  await expect(ai.getByText("Track record block").first()).toBeVisible();
  await expect(ai.getByText("Calibration details block").first()).toBeVisible();
  const example = ai.locator("[data-slot=wording-example]");
  await expect(example).toContainText("Example:");
  await ai.getByRole("radio", { name: "Numbers" }).click();
  await expect(example).toContainText("72%");
  await ai.getByRole("radio", { name: "Hidden" }).click();
  await expect(example).toContainText("Nothing");
});

test("the outline display choice is kept after a reload", async ({ page }) => {
  await page.goto("/settings/ai");
  const group = dialog(page).getByRole("radiogroup", { name: "Outline display" });
  await group.getByRole("radio", { name: "Bands" }).click();
  await page.reload();
  await expect(
    dialog(page)
      .getByRole("radiogroup", { name: "Outline display" })
      .getByRole("radio", { name: "Bands" }),
  ).toBeChecked();
});
