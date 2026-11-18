import { expect, test } from "./a11y.ts";

test("the Motion row sets the motion mode of the whole app and keeps it after a reload", async ({
  page,
}) => {
  await page.goto("/settings/display");
  const motion = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Motion" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "normal");
  await motion.getByRole("radio", { name: "Slower" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "presenting");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "presenting");
  await expect(
    page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("radiogroup", { name: "Motion" })
      .getByRole("radio", { name: "Slower" }),
  ).toBeChecked();
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Motion" })
    .getByRole("radio", { name: "Reduced" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});
