import { expect, type Page, test } from "./a11y.ts";

const rowOf = (page: Page, code: string) => page.getByRole("row").filter({ hasText: code });

const toast = (page: Page) => page.locator('[data-slot="toast"]');

const more = async (page: Page, code: string, item: string) => {
  await rowOf(page, code)
    .getByRole("button", { name: `More actions for ${code}` })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
};

test("each status shows its one action", async ({ page }) => {
  await page.goto("/my-work?tab=assigned");
  await expect(rowOf(page, "RT-15")).toBeVisible();
  const disagreements = page
    .getByRole("row")
    .filter({ hasText: /\d+ disagreements/ })
    .first();
  await expect(disagreements.getByRole("button", { name: "Resolve" })).toBeVisible();
  await expect(disagreements.getByRole("button", { name: "Nudge" })).toHaveCount(0);
  const busy = page
    .getByRole("row")
    .filter({ hasText: /In review|Not started/ })
    .first();
  await expect(busy.getByRole("button", { name: "Nudge" })).toBeVisible();
  await expect(busy.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await expect(busy.getByRole("button", { name: "Reassign" })).toHaveCount(0);
  const signed = page
    .getByRole("row")
    .filter({ hasText: /Signed off/ })
    .first();
  if ((await signed.count()) > 0) {
    await expect(signed.getByRole("button")).toHaveCount(0);
  }
});

test("Nudge sends from Assigned by me and Undo takes it back", async ({ page }) => {
  await page.goto("/my-work?tab=assigned");
  await rowOf(page, "RT-15").getByRole("button", { name: "Nudge" }).click();
  const dialog = page.getByRole("dialog", { name: "Nudge" });
  await expect(dialog).toContainText("RT-15 · PathoSAM vs CAMELYON");
  await expect(dialog).toContainText("Anna Kopecká");
  await expect(dialog.getByRole("textbox", { name: "Message" })).toHaveValue(
    /^Hi Anna, RT-15 is due .+ and has 12 slides left for you\. Could you fit some in this week\?$/,
  );
  const sent = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/nudges$/.test(response.url()),
  );
  await dialog.getByRole("button", { name: /Send/ }).click();
  expect((await sent).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page)).toContainText("Nudge sent to Anna Kopecká");
  const cancelled = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/nudges\//.test(response.url()),
  );
  await toast(page).getByRole("button", { name: "Undo" }).click();
  expect((await cancelled).status()).toBe(204);
});

test("Resolve opens the disagreement queue", async ({ page }) => {
  await page.goto("/my-work?tab=assigned");
  await page
    .getByRole("row")
    .filter({ hasText: /\d+ disagreements/ })
    .first()
    .getByRole("button", { name: "Resolve" })
    .click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/disagreements/);
});

test("the more menu changes the due date with Undo", async ({ page }) => {
  await page.goto("/my-work?tab=assigned");
  const before = await rowOf(page, "RT-15").getByRole("cell").nth(3).textContent();
  await more(page, "RT-15", "Change due date");
  const dialog = page.getByRole("dialog", { name: "Change due date" });
  await expect(dialog.getByText("Pick a new due date.")).toBeVisible();
  await dialog.getByRole("button", { name: /Due/ }).first().click();
  await page.getByRole("gridcell").filter({ hasNotText: /^$/ }).last().click();
  await dialog.getByRole("button", { name: "Change due date" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page)).toContainText(
    /RT-15 is now due .+\. Reviewers with slides left are told\./,
  );
  await expect(rowOf(page, "RT-15").getByRole("cell").nth(3)).not.toHaveText(before ?? "");
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(rowOf(page, "RT-15").getByRole("cell").nth(3)).toHaveText(before ?? "");
});

test("the more menu adds a reviewer to the task", async ({ page }) => {
  await page.goto("/my-work?tab=assigned");
  const reviewers = rowOf(page, "RT-15").getByRole("cell").nth(2).locator("> div > div");
  await expect(reviewers.first()).toBeVisible();
  const count = await reviewers.count();
  await more(page, "RT-15", "Add reviewer");
  const dialog = page.getByRole("dialog", { name: "Add reviewer" });
  await expect(dialog.getByText(/Pick who joins the task\.|Everyone who reviews/)).toBeVisible();
  await dialog.getByRole("combobox", { name: "Reviewer" }).click();
  const option = page.getByRole("option").first();
  const name = (await option.textContent()) ?? "";
  await option.click();
  await dialog.getByRole("button", { name: "Add reviewer" }).click();
  await expect(toast(page)).toContainText(`${name} joined RT-15 and is told by email.`);
  await expect(reviewers).toHaveCount(count + 1);
});
