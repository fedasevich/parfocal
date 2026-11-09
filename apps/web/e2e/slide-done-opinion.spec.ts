import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1280, height: 1100 } });

const card = (page: Page) => page.locator('[data-slot="slide-done-card"]');

test("answers on the Slide done card in guided review are in the full viewer's Opinion tab", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=done`);
  await expect(card(page)).toContainText("Slide 8 is done");
  await expect(card(page)).toContainText(
    "55 objects checked: 48 agree, 5 disagree, 2 not sure. 1 added.",
  );
  await expect(card(page).getByText("Required", { exact: true })).toHaveCount(2);
  await card(page).getByRole("radio", { name: "2" }).click();
  await card(page).getByRole("button", { name: "Missed tumor" }).click();
  await card(page).getByRole("radio", { name: "Yes" }).click();
  await card(page).getByRole("textbox", { name: "Comment" }).fill("Missed a small deposit");
  await expect(card(page).getByRole("radio", { name: "2" })).toBeChecked();

  await page.getByRole("radio", { name: "Full viewer" }).click();
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await page.getByRole("tab", { name: /^Opinion/ }).click();
  await expect(card(page).getByRole("radio", { name: "2" })).toBeChecked();
  await expect(card(page).getByRole("button", { name: "Missed tumor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(card(page).getByRole("radio", { name: "Yes" })).toBeChecked();
  await expect(card(page).getByRole("textbox", { name: "Comment" })).toHaveValue(
    "Missed a small deposit",
  );

  await card(page).getByRole("radio", { name: "5" }).click();
  await expect(card(page).getByRole("radio", { name: "5" })).toBeChecked();
});
