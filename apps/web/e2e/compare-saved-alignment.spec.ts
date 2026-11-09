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
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await page.getByRole("switch", { name: "Linked" }).click();
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-left")).toHaveText("15°");
  await expect(page.getByTestId("rotation-right")).toHaveText("30°");
  const aligning = saved(page);
  await page.getByRole("switch", { name: "Linked" }).click();
  await aligning;
  await expect(page.getByTestId("alignment-status")).toContainText("kept for this pair");

  await openCompare(page);
  await expect(page.getByTestId("alignment-status")).toContainText("kept for this pair");
  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await expect(page.getByTestId("rotation-left")).toHaveText("15°");
  await expect(page.getByTestId("rotation-right")).toHaveText("30°");

  const clearing = saved(page);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await clearing;
  await expect(page.getByTestId("alignment-status")).toContainText("Proposes a starting");

  await openCompare(page);
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
});
