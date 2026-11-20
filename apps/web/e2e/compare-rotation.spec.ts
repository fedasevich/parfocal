import { expect, test } from "./a11y.ts";
import { openCompare } from "./compare-open.ts";

test("rotating the right pane keeps the link and only turns that pane", async ({ page }) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await expect(page.getByTestId("rotation-right")).toHaveText("0°");
  await expect(page.getByTestId("rotation-left")).toHaveCount(0);
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
  await expect(page.getByRole("switch", { name: "Linked" })).toBeChecked();

  await page.getByRole("switch", { name: "Linked" }).click();
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("30°");

  await page.getByRole("button", { name: "Reset right pane rotation" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("0°");
});
