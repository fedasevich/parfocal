import { expect, test } from "./a11y.ts";

test("line up automatically proposes an offset and clearing keeps the panes linked", async ({
  page,
}) => {
  test.setTimeout(90_000);
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

  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await page.getByRole("button", { name: "Line up automatically" }).click();
  await expect(page.getByTestId("alignment-status")).toContainText("Proposed from the overviews");
  await expect(page.getByTestId("rotation-left")).toHaveText("15°");
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByTestId("alignment-status")).toContainText("Proposes a starting");
  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await expect(page.getByTestId("rotation-left")).toHaveText("30°");
});
