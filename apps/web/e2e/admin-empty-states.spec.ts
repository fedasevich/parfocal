import { expect, test } from "./a11y.ts";

test("the Archived projects filter says there are no archived projects", async ({ page }) => {
  await page.goto("/admin?section=projects");
  await expect(page.getByTestId("projects-empty")).toHaveCount(0);
  await page.getByRole("radio", { name: "Archived" }).click();
  const empty = page.getByTestId("projects-empty");
  await expect(empty).toContainText("No archived projects");
  await expect(empty).toContainText("A project you archive waits here");
  await expect(empty.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("0 archived projects")).toBeVisible();
  await page.getByRole("radio", { name: "Active" }).click();
  await expect(empty).toHaveCount(0);
});

test("the lab models table with no model offers to connect one", async ({ page }) => {
  await page.goto("/admin?section=models&labModels=none");
  const empty = page.getByTestId("lab-models-empty");
  await expect(empty).toContainText("Your lab has no model connected");
  await expect(page.getByTestId("parfocal-models-empty")).toHaveCount(0);
  await empty.getByRole("button", { name: "Connect your own model" }).click();
  await expect(page.getByRole("heading", { name: "Connect your own model" })).toBeVisible();
});

test("the lab models table lists the models when there are some", async ({ page }) => {
  await page.goto("/admin?section=models");
  await expect(page.getByText("Lab HoVer-Net fork", { exact: true })).toBeVisible();
  await expect(page.getByTestId("lab-models-empty")).toHaveCount(0);
});

test("a people search with no match says so and clears", async ({ page }) => {
  await page.goto("/admin?section=people");
  await expect(page.getByTestId("people-empty")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Find by name or email" }).fill("zzzz-nobody");
  const empty = page.getByTestId("people-empty");
  await expect(empty).toContainText("No one matches this search");
  await empty.getByRole("button", { name: "Clear the search" }).click();
  await expect(empty).toHaveCount(0);
});

test("the audit log says when no event matches the filters", async ({ page }) => {
  await page.goto("/admin?section=audit");
  await expect(page.getByTestId("audit-empty")).toHaveCount(0);
  await page.getByRole("button", { name: /^Person: Everyone/ }).click();
  await page.getByRole("option", { name: "Daniel Hruška", exact: true }).click();
  await page.getByRole("button", { name: /^Action: All actions/ }).click();
  await page.getByRole("option", { name: "People and roles", exact: true }).click();
  const empty = page.getByTestId("audit-empty");
  await expect(empty).toContainText("No events match these filters");
  await empty.getByRole("button", { name: "Clear filters" }).click();
  await expect(empty).toHaveCount(0);
});
