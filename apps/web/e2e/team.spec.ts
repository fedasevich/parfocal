import { expect, type Page, test } from "@playwright/test";

const task = (page: Page, code: string) =>
  page.getByRole("region", { name: new RegExp(`^${code} · `) });

const row = (page: Page, code: string, name: string) =>
  task(page, code).locator('[data-slot="reviewer-row"]').filter({ hasText: name });

const toast = (page: Page) => page.locator('[data-slot="toast"]');

test("every Team scene opens on fake data as Daniel Hruška", async ({ page }) => {
  const scenes: { scene: string; shows: string; dialog?: string }[] = [
    { scene: "open", shows: "2 open tasks · 1 reviewer behind" },
    { scene: "done", shows: "Signed off 14 Oct" },
    { scene: "nudge", shows: "4 of 12 slides done", dialog: "Nudge" },
    { scene: "reassign", shows: "The 8 slides not started", dialog: "Reassign slides" },
    { scene: "sent", shows: "3 open tasks" },
    { scene: "signoff", shows: "8 slides left · about 2 h 40 min" },
    { scene: "overdue", shows: "Due Fri 23 Oct · overdue by 1 day" },
    { scene: "away", shows: "RT-15 waits for Anna. Reassign if it cannot." },
    {
      scene: "partial",
      shows: "4 slides already have Simona's decisions",
      dialog: "Reassign slides",
    },
  ];
  for (const { scene, shows, dialog } of scenes) {
    await page.goto(`/team?scene=${scene}`);
    await expect(
      page.getByRole("heading", { name: "Team", exact: true, includeHidden: true }),
    ).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    if (dialog) await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
    await expect(page.getByTestId("fake-data-badge")).toContainText("Daniel Hruška");
  }
});

test("the scenes set their state like the mock", async ({ page }) => {
  await page.goto("/team?scene=sent");
  await expect(task(page, "RT-16")).toHaveAttribute("data-highlight", "true");
  await expect(row(page, "RT-16", "Lenka Malá")).toContainText("told just now");

  await page.goto("/team?scene=signoff");
  await expect(row(page, "RT-14", "Simona Marková")).toHaveAttribute("data-highlight", "true");

  await page.goto("/team?scene=overdue");
  await expect(row(page, "RT-14", "Lenka Malá")).toContainText("Behind");
  await expect(page.getByText("2 reviewers behind · 1 overdue")).toBeVisible();

  await page.goto("/team?scene=away");
  const anna = row(page, "RT-15", "Anna Kopecká");
  await expect(anna).toContainText("until Mon 19 Oct");
  await expect(anna.getByRole("button", { name: "Nudge" })).toHaveCount(0);

  await page.goto("/team?scene=partial");
  const dialog = page.getByRole("dialog", { name: "Reassign slides" });
  await expect(dialog).toContainText("Jan Růžička");
  await expect(dialog.getByRole("button", { name: /Reassign 12 slides/ })).toBeEnabled();
});

test("Nudge sends, marks the row and Undo takes it back", async ({ page }) => {
  await page.goto("/team");
  const simona = row(page, "RT-14", "Simona Marková");
  await simona.getByRole("button", { name: "Nudge" }).click();
  const dialog = page.getByRole("dialog", { name: "Nudge" });
  await expect(dialog.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Hi Simona, RT-14 is due Fri 23 Oct and 8 slides are left. Could you fit some in this week?",
  );
  await dialog.getByRole("button", { name: /Send/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page)).toContainText("Nudge sent to Simona Marková");
  await expect(simona).toContainText("nudged just now");
  await expect(simona.getByRole("button", { name: "Nudge" })).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(simona).not.toContainText("nudged just now");
  await expect(simona.getByRole("button", { name: "Nudge" })).toBeVisible();
});

test("an empty nudge cannot be sent", async ({ page }) => {
  await page.goto("/team?scene=nudge");
  const dialog = page.getByRole("dialog", { name: "Nudge" });
  await dialog.getByRole("textbox", { name: "Message" }).fill("");
  await expect(dialog.getByText("Write a message to send.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Send/ })).toBeDisabled();
});

test("Reassign moves the slides not started to a new row and Undo puts them back", async ({
  page,
}) => {
  await page.goto("/team");
  await row(page, "RT-14", "Simona Marková").getByRole("button", { name: "Reassign" }).click();
  const dialog = page.getByRole("dialog", { name: "Reassign slides" });
  await expect(dialog.getByText("Pick who takes the slides.")).toBeVisible();
  await dialog.getByRole("combobox", { name: "To" }).fill("Jan");
  await dialog.getByRole("option", { name: /Jan Růžička/ }).click();
  await dialog.getByRole("button", { name: /Reassign 8 slides/ }).click();
  await expect(toast(page)).toContainText(
    "8 slides of RT-14 moved to Jan Růžička. Both are told by email.",
  );
  await expect(row(page, "RT-14", "Jan Růžička")).toContainText("told just now");
  await expect(row(page, "RT-14", "Simona Marková")).toContainText("all 4 submitted");
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "RT-14", "Jan Růžička")).toHaveCount(0);
  await expect(row(page, "RT-14", "Simona Marková")).toContainText("Behind");
});

test("Nudge all behind asks in the button, then nudges everyone behind", async ({ page }) => {
  await page.goto("/team");
  await page.getByRole("button", { name: "Nudge all behind" }).click();
  await expect(page.getByText("Nudge Simona?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Nudge all behind" }).click();
  await page.getByRole("button", { name: "Yes, nudge" }).click();
  await expect(toast(page)).toContainText("Nudge sent to Simona Marková");
  await expect(row(page, "RT-14", "Simona Marková")).toContainText("nudged just now");
  const button = page.getByRole("button", { name: "Nudge all behind" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", "Everyone behind was nudged");
});

test("the filters, the Done tab and Open the report", async ({ page }) => {
  await page.goto("/team");
  await page.getByRole("combobox", { name: "Reviewer" }).click();
  await page.getByRole("option", { name: "Anna Kopecká" }).click();
  await expect(task(page, "RT-14")).toHaveCount(0);
  await expect(task(page, "RT-15")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(task(page, "RT-14")).toBeVisible();
  await page.getByRole("tab", { name: /Done/ }).click();
  await expect(page).toHaveURL(/tab=done/);
  await expect(page.getByRole("button", { name: "Nudge all behind" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: "Breast TILs, cell typing" }).click();
  await expect(page.getByText("RT-09")).toHaveCount(0);
  await page.getByRole("button", { name: "Open the report" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/evaluation$/);
});

test("a filter that matches nothing says so and clears", async ({ page }) => {
  await page.goto("/team?tab=done&reviewer=00000000-0000-4000-8001-000000000004");
  await expect(page.getByText("No signed-off task matches these filters.")).toBeVisible();
  await page
    .locator('[data-slot="team-no-match"]')
    .getByRole("button", { name: "Clear filters" })
    .click();
  await expect(page.getByText("Signed off 14 Oct")).toBeVisible();
});
