import { expect, test } from "./a11y.ts";

const sections = [
  "Overview",
  "People and roles",
  "Projects",
  "AI models",
  "Report templates",
  "Storage and sources",
  "API and webhooks",
  "Audit log",
  "Security",
];

test("the sidebar leads with Back to Parfocal and lists every section", async ({ page }) => {
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await expect(nav.getByRole("link").first()).toHaveText("Back to Parfocal");
  for (const label of sections) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByText("Admin · Fakultní nemocnice Vltava")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a section link opens that section and marks it current", async ({ page }) => {
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  for (const label of ["Audit log", "Storage and sources", "People and roles"]) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true }).first()).toBeVisible();
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await expect(page).toHaveURL(/section=people/);
});

test("Back to Parfocal returns to the home", async ({ page }) => {
  await page.goto("/admin?section=security");
  await page.getByRole("link", { name: "Back to Parfocal" }).click();
  await expect(page).not.toHaveURL(/\/admin/);
  await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
});

test("a reviewer is refused and sees no admin section", async ({ page }) => {
  await page.goto("/admin?as=LM");
  await expect(
    page.getByRole("heading", { name: "The admin page is for people with admin rights" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to Parfocal" }).click();
  await expect(page).not.toHaveURL(/\/admin/);
});

test("a reviewer is refused on a deep section link too", async ({ page }) => {
  await page.goto("/admin?section=audit&as=AK");
  await expect(page.getByRole("alert")).toContainText("Ask a researcher with admin rights");
  await expect(page.getByRole("heading", { name: "Audit log" })).toHaveCount(0);
});

test("the main sidebar shows Admin to an admin and hides it from a reviewer", async ({ page }) => {
  await page.goto("/?as=DH");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();
  await page.goto("/?as=LM");
  await expect(page.getByRole("link", { name: "Team", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
});
