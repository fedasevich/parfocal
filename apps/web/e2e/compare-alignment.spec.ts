import { expect, test } from "./a11y.ts";
import { openCompare, openCompareOptions } from "./compare-open.ts";

test("line up automatically proposes an offset and clearing keeps the panes linked", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  const options = await openCompareOptions(page);
  await options.getByRole("button", { name: "Line up automatically" }).click();
  await expect(page.getByTestId("alignment-status")).toContainText("Proposed from the overviews");
  await options.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByTestId("alignment-status")).toContainText("Proposes a starting");
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
  await expect(page.getByRole("switch", { name: "Linked" })).toBeChecked();
});
