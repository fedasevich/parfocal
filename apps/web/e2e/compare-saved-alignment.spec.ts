import { expect, type Page, test } from "./a11y.ts";
import { openCompare, openCompareOptions } from "./compare-open.ts";

const saved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/me/setting-layers"),
  );

test("an aligned compare pair is kept, restored after reopening and cleared by Clear", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openCompare(page);
  await openCompareOptions(page);
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);

  const aligning = saved(page);
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
  await aligning;
  await expect(page.getByTestId("alignment-status")).toContainText("kept for this pair");

  await openCompare(page);
  await openCompareOptions(page);
  await expect(page.getByTestId("alignment-status")).toContainText("kept for this pair");
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");

  const clearing = saved(page);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await clearing;
  await expect(page.getByTestId("alignment-status")).toContainText("Proposes a starting");
  await expect(page.getByTestId("rotation-right")).toHaveText("0°");

  await openCompare(page);
  await openCompareOptions(page);
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("rotation-right")).toHaveText("0°");
});
