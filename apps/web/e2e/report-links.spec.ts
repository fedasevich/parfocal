import { expect, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test("an owner shares a read-only link, a signed out reader sees only numbers, revoking ends it", async ({
  page,
  context,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation`);
  const heads = page.locator('[data-slot="report-objects-table"] thead th');
  await expect(heads.nth(4)).toBeVisible();
  const people = (await heads.allTextContents())
    .slice(3)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  expect(people.length).toBeGreaterThan(1);

  await page.getByRole("button", { name: /Compare and share/ }).click();
  await page.getByRole("button", { name: "Read-only link" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("No links yet.")).toBeVisible();
  await dialog.getByRole("button", { name: /Make a link/ }).click();
  const field = dialog.getByRole("textbox", { name: "New link" });
  await expect(field).toHaveValue(/\/shared-reports\/\w+$/);
  const link = new URL(await field.inputValue());
  const listed = dialog.getByRole("list", { name: "Report links" }).getByRole("listitem");
  await expect(listed).toHaveCount(1);
  await expect(listed.first()).toContainText("Active");
  await expect(listed.first()).toContainText("Not opened");

  const reader = await context.newPage();
  const asked: string[] = [];
  reader.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/api/")) asked.push(path);
  });
  await reader.goto(link.pathname);
  await expect(reader.getByRole("heading", { level: 1 })).toBeVisible();
  const agreement = reader.getByRole("table", { name: "Agreement between reviewers" });
  await expect(agreement).toContainText("Reviewer A and Reviewer B");
  await expect(reader.getByText("Read-only", { exact: true })).toBeVisible();
  const shown = await reader.locator("main").innerText();
  expect(people.filter((name) => shown.includes(name))).toEqual([]);
  expect(shown).not.toMatch(uuid);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.filter((path) => !path.includes("/api/shared-reports/"))).toEqual([]);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Read-only link" }).click();
  const again = page.getByRole("dialog").getByRole("listitem");
  await expect(again.first()).toContainText(/Opened (once|\d+ times)/);
  await again.first().getByRole("button", { name: "Revoke" }).click();
  await expect(again.first()).toContainText("Revoked");

  await reader.reload();
  await expect(reader.getByRole("alert")).toContainText("This link was revoked or has expired");
  await expect(reader.getByRole("table")).toHaveCount(0);
});
