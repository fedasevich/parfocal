import { expect, type Locator, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const tasks = `/projects/${p07}?tab=tasks`;

const pressSave = async (drawer: Locator) => {
  const save = drawer.getByRole("button", { name: "Save Counts as" });
  await save.focus();
  await save.press("Enter");
};

const row = (page: Page, code: string) => page.getByTestId("task-row").filter({ hasText: code });

test("Counts as changes on a seeded task after a confirm that says what it recounts", async ({
  page,
}) => {
  await page.goto(tasks);
  await row(page, "RT-13").getByRole("button", { name: "Settings for RT-13" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings for RT-13" });
  await expect(drawer.getByText("5-point certainty")).toBeVisible();
  await expect(drawer.getByText("4 and 5 count as agree with the AI")).toBeVisible();
  await expect(drawer.getByText("17 agree · 5 not sure · 6 disagree")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Save Counts as" })).toBeDisabled();

  await drawer.getByRole("button", { name: "Raise Agree starts at" }).click();
  await expect(drawer.getByText("5 counts as agree with the AI")).toBeVisible();
  await expect(drawer.getByText("9 agree · 13 not sure · 6 disagree")).toBeVisible();
  await pressSave(drawer);

  const confirm = page.getByRole("dialog", { name: "Change Counts as on RT-13?" });
  await expect(confirm.getByTestId("recount")).toHaveText("Recounts 8 of 28 answers.");
  await confirm.getByRole("button", { name: "Change Counts as" }).click();
  await expect(confirm).toBeHidden();

  await page.getByRole("link", { name: "See the Methods block" }).click();
  const methods = page.locator("[data-methods]").first();
  await expect(methods).toContainText("Reviewers answered in the 5-point certainty style.");
  await expect(methods).toContainText("5 counts as agree with the AI");
  await expect(methods).toContainText("The decisions count as 9 agree, 6 disagree, 13 not sure.");
  await expect(methods).toContainText("changed Counts as on");
  await expect(methods).toContainText("(8 recounted)");
});

test("Cancel in the confirm keeps the mapping", async ({ page }) => {
  await page.goto(tasks);
  await row(page, "RT-13").getByRole("button", { name: "Settings for RT-13" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings for RT-13" });
  await drawer.getByRole("button", { name: "Lower Disagree ends at" }).click();
  await pressSave(drawer);
  const confirm = page.getByRole("dialog", { name: "Change Counts as on RT-13?" });
  await expect(confirm.getByTestId("recount")).toHaveText("Recounts 4 of 28 answers.");
  await confirm.getByRole("button", { name: /Cancel/ }).click();
  await expect(confirm).toBeHidden();
  await drawer.getByRole("button", { name: "Close", exact: true }).first().click();
  await row(page, "RT-13").getByRole("button", { name: "Settings for RT-13" }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings for RT-13" }).getByText("4 and 5 count as agree"),
  ).toBeVisible();
});

test("a signed-off task shows Counts as locked", async ({ page }) => {
  await page.goto(tasks);
  await row(page, "RT-09").getByRole("button", { name: "Settings for RT-09" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings for RT-09" });
  await expect(
    drawer.getByText("This task is signed off, so the mapping is locked."),
  ).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Save Counts as" })).toBeDisabled();
});
