import { expect, test } from "./telemetry-capture.ts";

const created = "00000000-0000-4000-8003-000000000012";

for (const path of ["/", "/my-work", "/team"]) {
  test(`New project opens its drawer over ${path} without leaving it`, async ({ page }) => {
    await page.goto(path);
    const before = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "New project" }).first().click();
    const drawer = page.getByRole("dialog", { name: "New project" });
    await expect(drawer).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(before);
    expect(page.url()).not.toContain("/projects/");

    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(drawer).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(before);
  });
}

test("creating from the drawer goes to the new project", async ({ page }) => {
  await page.goto("/my-work");
  await page.getByRole("button", { name: "New project" }).first().click();
  const drawer = page.getByRole("dialog", { name: "New project" });
  await drawer.getByRole("textbox").fill("Drawer anywhere study");
  await drawer.getByRole("button", { name: "Create and upload" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${created}/upload`));
  await expect(page.getByRole("dialog", { name: "New project" })).toHaveCount(0);
});

test("the sidebar entry opens the drawer over the current page", async ({ page }) => {
  await page.goto("/my-work");
  await page.getByRole("link", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/my-work");
});
