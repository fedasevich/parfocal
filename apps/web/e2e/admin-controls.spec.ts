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
