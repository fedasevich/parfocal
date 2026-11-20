import { expect, type Page } from "@playwright/test";

export async function openCompare(page: Page) {
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
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page).toHaveURL(/with=/);
  await expect(page).not.toHaveURL(/scene=/);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

export const comparePane = (page: Page, side: string) => page.locator(`[data-pane="${side}"]`);

export const stillEngineOn = (page: Page, side: string) =>
  comparePane(page, side).getByTestId("still-engine");

export async function openCompareOptions(page: Page) {
  await page.getByRole("button", { name: "Compare options" }).click();
  return page.getByRole("region", { name: "Compare options" });
}
