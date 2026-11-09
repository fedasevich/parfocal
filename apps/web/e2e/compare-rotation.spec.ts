import { expect, test } from "./a11y.ts";

test("rotating one compare pane turns both while linked and only itself once unlinked", async ({
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

  await expect(page.getByTestId("rotation-left")).toHaveText("0°");
  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await expect(page.getByTestId("rotation-left")).toHaveText("15°");
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");

  await page.getByRole("switch", { name: "Linked" }).click();
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-left")).toHaveText("15°");
  await expect(page.getByTestId("rotation-right")).toHaveText("30°");

  await page.getByRole("button", { name: "Reset right pane rotation" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("0°");
});
