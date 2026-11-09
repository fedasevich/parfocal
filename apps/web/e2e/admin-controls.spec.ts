import { expect, test } from "@playwright/test";

test("an admin sets how long deleted items are kept and it stays after a reload", async ({
  page,
}) => {
  await page.goto("/admin?section=storage");
  const deleted = page.getByRole("combobox", { name: "Remove deleted items after" });
  await expect(deleted).toContainText("Keep everything");
  await expect(page.getByText("(mock)")).toHaveCount(0);

  await deleted.click();
  await page.getByRole("option", { name: "90 days" }).click();
  await expect(
    page.getByText("Deleted slides, annotations and results are removed after 90 days."),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Remove deleted items after" })).toContainText(
    "90 days",
  );
  await expect(page.getByRole("combobox", { name: "Keep audit events for" })).toContainText(
    "Keep everything",
  );
});

test("the security section changes the lock time instead of a switch", async ({ page }) => {
  await page.goto("/admin?section=security");
  await expect(page.getByRole("switch", { name: "Lock after inactivity" })).toHaveCount(0);
  const lock = page.getByRole("combobox", { name: "Lock after inactivity" });
  await expect(lock).toContainText("15 minutes");
  await lock.click();
  await page.getByRole("option", { name: "1 hour" }).click();
  await expect(page.getByText("Screens lock after 1 hour without activity.")).toBeVisible();
  await expect(lock).toContainText("1 hour");
});

test("the projects section sets the class list of new projects", async ({ page }) => {
  await page.goto("/admin?section=projects");
  const classes = page.getByRole("combobox", { name: "Class list of new projects" });
  await expect(classes).toContainText("No classes");
  await classes.click();
  await page.getByRole("option", { name: "PanNuke" }).click();
  await expect(page.getByText("New projects start with that class list.")).toBeVisible();
  await expect(classes).toContainText("PanNuke");
});

test("the security section shows no switch that saves nothing", async ({ page }) => {
  await page.goto("/admin?section=security");
  await expect(page.getByRole("switch", { name: "Two factors for everyone" })).toBeEnabled();
  for (const hidden of ["Log every slide opened", "Watermark exports", "Data stays in the EU"]) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }
  await expect(page.getByRole("switch", { name: "Email and password" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Sign-in links by email" })).toBeDisabled();
});

test("the privacy of new projects saves to the workspace default", async ({ page }) => {
  await page.goto("/admin?section=projects");
  await expect(page.getByRole("radiogroup", { name: "Who can create a project" })).toHaveCount(0);
  await expect(page.getByText("Who can create one")).toHaveCount(0);
  const privacy = page.getByRole("radiogroup", { name: "Privacy of new projects" });
  await expect(privacy.getByRole("radio", { name: "De-identified" })).toBeChecked();
  await privacy.getByRole("radio", { name: "Clinical" }).click();
  await expect(page.getByText("New projects start clinical.")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Workspace settings", exact: true }).click();
  await expect(page).toHaveURL(/section=settings/);
  await expect(
    page
      .getByRole("radiogroup", { name: "Privacy of new projects" })
      .getByRole("radio", { name: "Clinical" }),
  ).toBeChecked();
  await nav.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page
      .getByRole("radiogroup", { name: "Privacy of new projects" })
      .getByRole("radio", { name: "Clinical" }),
  ).toBeChecked();
});
