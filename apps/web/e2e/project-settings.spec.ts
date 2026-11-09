import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";

test("review defaults, study template and ID matching save on the project", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=settings`);
  const settings = page.getByTestId("project-settings");
  const changes: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH")
      changes.push(request.postDataJSON() as Record<string, unknown>);
  });
  const blind = settings.getByRole("switch", { name: "Blind review" });
  await expect(blind).toBeChecked();
  await blind.click();
  await expect(blind).not.toBeChecked();
  const firstRead = settings.getByRole("switch", { name: "Hide the AI for a first read" });
  await firstRead.click();
  await expect(firstRead).toBeChecked();
  const templates = settings.getByRole("radiogroup", { name: "Study template" }).getByRole("radio");
  await templates.last().click();
  await expect(templates.last()).toBeChecked();
  await settings.getByRole("button", { name: "Raise Region overlap" }).click();
  await expect(settings.getByRole("textbox", { name: "Region overlap" })).toHaveValue("0.55");
  await settings.getByRole("button", { name: "Lower Cell distance" }).click();
  await expect(settings.getByRole("textbox", { name: "Cell distance" })).toHaveValue("3.5");
  await expect(settings.getByRole("radiogroup", { name: "Report template" })).toHaveCount(0);
  await expect
    .poll(() => changes.map((change) => Object.keys(change)[0]))
    .toEqual([
      "blinded",
      "ai_hidden_first_read",
      "study_template_id",
      "match_iou",
      "match_distance_um",
    ]);
});

test("a clinical project picks its report template", async ({ page }) => {
  await page.goto(`/projects/${p03}?tab=settings`);
  const group = page.getByRole("radiogroup", { name: "Report template" });
  await expect(group.getByRole("radio", { name: /Sentinel node report v2/ })).toBeChecked();
  await group.getByRole("radio", { name: /Lymph node excision report v1/ }).click();
  await expect(group.getByRole("radio", { name: /Lymph node excision report v1/ })).toBeChecked();
});

test("Can sign out shows a viewer as Never and warns when nobody could sign out", async ({
  page,
}) => {
  await page.goto(`/projects/${p03}?tab=settings`);
  const rights = page.getByTestId("sign-out-rights");
  await expect(rights).toContainText("Can sign out");
  const viewer = rights
    .getByTestId("sign-out-row")
    .filter({ has: page.getByTitle("Viewers cannot sign out") });
  await expect(viewer).toHaveCount(1);
  await expect(viewer).toContainText("Viewer");
  await expect(viewer.getByTitle("Viewers cannot sign out")).toHaveText("Never");
  await expect(viewer.getByRole("radiogroup")).toHaveCount(0);
  const warning = rights.getByRole("alert");
  await expect(warning).toHaveCount(0);
  const groups = rights.getByRole("radiogroup");
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    await groups.nth(index).getByRole("radio", { name: "Never" }).click();
  }
  await expect(warning).toHaveText(
    "Nobody could sign out in this project. Reports would all go for co-sign.",
  );
  await groups.first().getByRole("radio", { name: "Any case" }).click();
  await expect(warning).toHaveCount(0);
});

test("an owner deletes a project only after typing its name", async ({ page }) => {
  const deletions: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE" && request.url().endsWith(`/api/projects/${p07}`))
      deletions.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.goto(`/projects/${p07}?tab=settings&as=SM`);
  const settings = page.getByTestId("project-settings");
  await expect(settings.getByRole("switch", { name: "Blind review" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Delete project" })).toHaveCount(0);

  await page.goto(`/projects/${p07}?tab=settings&as=DH`);
  await settings.getByRole("button", { name: "Delete project" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete P07?" });
  await expect(dialog.getByTestId("project-delete-goes")).toContainText("61 slides");
  await expect(dialog).toContainText("an owner can restore the project");
  await dialog.getByRole("button", { name: "Delete project" }).click();
  await expect(dialog).toContainText("Type Sentinel node AI evaluation to confirm.");
  await dialog.getByRole("textbox").fill("Sentinel node");
  await expect(dialog.getByRole("button", { name: "Delete project" })).toBeDisabled();
  await expect(dialog).toContainText("The name does not match.");
  expect(deletions).toHaveLength(0);
  await dialog.getByRole("textbox").fill("Sentinel node AI evaluation");
  await dialog.getByRole("button", { name: "Delete project" }).click();
  await expect(dialog).toHaveCount(0);
  expect(deletions).toEqual([{ name: "Sentinel node AI evaluation" }]);
  await expect(page).not.toHaveURL(/\/projects\//);
});

test("an owner finds a deleted project in Deleted projects and restores it", async ({ page }) => {
  const restores: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/projects/${p07}/undelete`))
      restores.push(request.url());
  });
  await page.goto(`/projects/${p07}?tab=settings&as=DH`);
  await page
    .getByTestId("project-settings")
    .getByRole("button", { name: "Delete project" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Delete P07?" });
  await dialog.getByRole("textbox").fill("Sentinel node AI evaluation");
  await dialog.getByRole("button", { name: "Delete project" }).click();
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => {
    window.history.pushState({}, "", "/admin?section=projects");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const deleted = page.getByTestId("deleted-projects");
  await expect(deleted).toContainText("Sentinel node AI evaluation");
  await deleted.getByRole("button", { name: "Restore Sentinel node AI evaluation" }).click();
  await expect(page.getByTestId("deleted-projects-empty")).toBeVisible();
  expect(restores).toHaveLength(1);
  await expect(page.getByRole("cell", { name: "Sentinel node AI evaluation P07" })).toBeVisible();

  const projectRow = page.getByRole("row", { name: /Sentinel node AI evaluation/ });
  await page.getByRole("button", { name: "Archive Sentinel node AI evaluation" }).click();
  await expect(projectRow).toHaveCount(0);
  await page.getByRole("radio", { name: "Archived" }).click();
  await expect(projectRow).toContainText("Archived");
  await page.getByRole("button", { name: "Unarchive Sentinel node AI evaluation" }).click();
  await expect(projectRow).toHaveCount(0);
  await page.getByRole("radio", { name: "Active" }).click();
  await expect(projectRow).toContainText("Active");

  await page.getByRole("link", { name: "Back to Parfocal" }).click();
  await expect(page.getByText("Sentinel node AI evaluation").first()).toBeVisible();
});
