import { expect, test } from "./a11y.ts";

test("the row menu removes a person after a confirm and the removal stays after a reload", async ({
  page,
}) => {
  await page.goto("/admin?section=people");
  const row = page.getByRole("row", { name: /^TB Tomáš Beneš/ });
  await expect(row).toContainText("Active");

  await row.getByRole("button", { name: "More for Tomáš Beneš" }).click();
  await expect(page.getByRole("menuitem", { name: "Make a researcher" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Remove from the workspace" }).click();

  const dialog = page.getByRole("dialog", { name: "Remove Tomáš Beneš from the workspace" });
  await expect(dialog.getByText("Slides to review in P07")).toBeVisible();
  await dialog.getByRole("button", { name: "Remove Tomáš Beneš" }).click();
  await expect(
    page.getByText("Tomáš Beneš was removed and can no longer sign in here."),
  ).toBeVisible();
  await expect(row).toContainText("Removed");

  await page.reload();
  const after = page.getByRole("row", { name: /^TB Tomáš Beneš/ });
  await expect(after).toContainText("Removed");
  await expect(after.getByRole("button", { name: "More for Tomáš Beneš" })).toHaveCount(0);
});

test("the row menu changes a role through the API and it stays after a reload", async ({
  page,
}) => {
  await page.goto("/admin?section=people");
  const row = page.getByRole("row", { name: /^TB Tomáš Beneš/ });
  await expect(row.getByRole("combobox", { name: "Role of Tomáš Beneš" })).toContainText(
    "Reviewer",
  );

  await row.getByRole("button", { name: "More for Tomáš Beneš" }).click();
  await page.getByRole("menuitem", { name: "Make a researcher" }).click();
  await expect(page.getByText("Tomáš Beneš is a researcher now.")).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole("row", { name: /^TB Tomáš Beneš/ })
      .getByRole("combobox", { name: "Role of Tomáš Beneš" }),
  ).toContainText("Researcher");
});

test("the menu leaves out what the last admin cannot do", async ({ page }) => {
  await page.goto("/admin?section=people");
  const row = page.getByRole("row", { name: /^DH Daniel Hruška/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "More for Daniel Hruška" })).toHaveCount(0);
});

test("the row menu revokes an invite after a confirm and it stays gone after a reload", async ({
  page,
}) => {
  await page.goto("/admin?section=people");
  await expect(page.getByText("3 invites waiting")).toBeVisible();
  const row = page.getByRole("row", { name: /karel@cuailab.example/ });
  await row.getByRole("button", { name: "More for karel@cuailab.example" }).click();
  await page.getByRole("menuitem", { name: "Revoke the invite" }).click();

  const dialog = page.getByRole("dialog", { name: "Revoke the invite to karel@cuailab.example" });
  await dialog.getByRole("button", { name: "Revoke invite" }).click();
  await expect(page.getByText("The invite to karel@cuailab.example was revoked.")).toBeVisible();
  await expect(page.getByRole("row", { name: /karel@cuailab.example/ })).toHaveCount(0);
  await expect(page.getByText("2 invites waiting")).toBeVisible();

  await page.reload();
  await expect(page.getByText("2 invites waiting")).toBeVisible();
  await expect(page.getByRole("row", { name: /karel@cuailab.example/ })).toHaveCount(0);
});
