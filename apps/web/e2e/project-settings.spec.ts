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
