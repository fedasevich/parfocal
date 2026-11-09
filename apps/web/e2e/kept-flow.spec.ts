import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";
const a1 = "00000000-0000-4000-8005-000000000001";

const current = (page: Page, testId: string) =>
  page.getByTestId(testId).locator('[aria-current="step"]');

test("Add a result set keeps its step and choice and reopens a visited step", async ({ page }) => {
  await page.goto(`/projects/${p07}/upload?scene=viewer`);
  const flow = page.getByTestId("add-result-set");
  await expect(current(page, "add-result-set")).toHaveText(/File/);
  await flow.getByRole("button", { name: "Next" }).click();
  await expect(current(page, "add-result-set")).toHaveText(/Check/);
  const show = flow.getByRole("switch", { name: "Show after adding" });
  await show.click();
  await expect(show).not.toBeChecked();

  await page.goto(`/projects/${p07}`);
  await expect(page.getByTestId("project-page")).toBeVisible();
  await page.goto(`/projects/${p07}/upload?scene=viewer`);
  await expect(current(page, "add-result-set")).toHaveText(/Check/);
  await expect(flow.getByRole("switch", { name: "Show after adding" })).not.toBeChecked();

  await flow.getByRole("button", { name: /File/ }).first().click();
  await expect(current(page, "add-result-set")).toHaveText(/File/);
  await flow.getByRole("button", { name: /Check/ }).first().click();
  await expect(current(page, "add-result-set")).toHaveText(/Check/);
});

test("Connect a model comes back on Classes and access with the class choice kept", async ({
  page,
}) => {
  await page.goto("/admin?scene=addtested");
  await page.getByRole("button", { name: "Next: classes and access" }).click();
  await expect(page).toHaveURL(/scene=addmap/);
  await page.getByRole("combobox", { name: "Class for dead" }).click();
  await page.getByRole("option", { name: "Leave out of results" }).click();
  await expect(page.getByText("Every class has a match.")).toBeVisible();

  await page.goto("/admin");
  await page.goto("/admin?scene=addmodel");
  await expect(page).toHaveURL(/scene=addmap/);
  await expect(page.getByText("Every class has a match.")).toBeVisible();

  const flow = page.getByTestId("connect-model");
  await flow
    .getByRole("button", { name: /Connect and test/ })
    .first()
    .click();
  await expect(page).toHaveURL(/scene=addtested/);
  await flow
    .getByRole("button", { name: /Classes and access/ })
    .first()
    .click();
  await expect(page).toHaveURL(/scene=addmap/);
  await expect(page.getByText("Every class has a match.")).toBeVisible();
});

test("New review task comes back on its step with the name kept", async ({ page }) => {
  const newTask = `/projects/${p07}/tasks/new`;
  await page.goto(newTask);
  const flow = page.getByTestId("new-task");
  await expect(current(page, "new-task")).toHaveText(/Kind/);
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("textbox", { name: "Task name" }).fill("Round 9 kept");
  for (const step of ["Reviewers", "What to check", "How it runs", "Send"]) {
    await flow.getByRole("button", { name: "Next" }).click();
    await expect(current(page, "new-task")).toHaveText(new RegExp(step));
  }

  await page.goto(`/projects/${p07}`);
  await expect(page.getByTestId("project-page")).toBeVisible();
  await page.goto(newTask);
  await expect(current(page, "new-task")).toHaveText(/Send/);

  await flow
    .getByRole("button", { name: /Slides/ })
    .first()
    .click();
  await expect(current(page, "new-task")).toHaveText(/Slides/);
  await expect(flow.getByRole("textbox", { name: "Task name" })).toHaveValue("Round 9 kept");
  await flow.getByRole("button", { name: /Send/ }).first().click();
  await expect(current(page, "new-task")).toHaveText(/Send/);
});

test("Clinical report comes back on its step with the staging choice kept", async ({ page }) => {
  const report = `/projects/${p03}/cases/00000000-0000-4000-8004-000000000006/report`;
  await page.goto(report);
  const flow = page.getByTestId("clinical-report");
  await flow.getByRole("button", { name: "Next" }).click();
  await expect(current(page, "clinical-report")).toHaveText(/Staging/);
  await flow.getByRole("radio", { name: /Macrometastasis/ }).click();
  await flow.getByRole("radio", { name: "Absent" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await expect(current(page, "clinical-report")).toHaveText(/Report text/);

  await page.goto(`/projects/${p03}`);
  await expect(page.getByTestId("project-page")).toBeVisible();
  await page.goto(report);
  await expect(current(page, "clinical-report")).toHaveText(/Report text/);

  await flow
    .getByRole("button", { name: /Staging/ })
    .first()
    .click();
  await expect(current(page, "clinical-report")).toHaveText(/Staging/);
  await expect(flow.getByRole("radio", { name: "Absent" })).toBeChecked();
  await flow
    .getByRole("button", { name: /Report text/ })
    .first()
    .click();
  await expect(current(page, "clinical-report")).toHaveText(/Report text/);
});
