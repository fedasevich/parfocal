import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const p09 = "00000000-0000-4000-8003-000000000009";

const tray = (page: Page) => page.getByRole("dialog", { name: "Jobs" });

async function openTray(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Jobs, 2 running" }).click();
  await expect(tray(page)).toBeVisible();
}

test("the tray lists running and finished uploads and runs with their state", async ({ page }) => {
  await openTray(page);
  await expect(tray(page).getByText("Running · 2")).toBeVisible();
  await expect(tray(page)).toContainText("Upload into P07");
  await expect(tray(page)).toContainText("46% · 3 min left");
  await expect(tray(page)).toContainText("CAMELYON tumor model v1.0");
  await expect(tray(page)).toContainText("Paused at 38%");
  await expect(tray(page)).toContainText("Upload into P09");
  await expect(tray(page)).toContainText("12 slides · today 09:12");
  await expect(tray(page)).toContainText("HoVer-Net v2.1");
  await expect(tray(page)).toContainText("4 slides in P09 · yesterday");
});

test("a running upload opens from the tray on its steps", async ({ page }) => {
  await openTray(page);
  await tray(page).getByRole("button", { name: "Upload into P07" }).click();
  await expect(tray(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/upload\\?scene=progress`));
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "progress");
  await expect(page.getByTestId("upload-file-progress")).toHaveCount(6);
});

test("a paused run resumes from the tray and opens on its steps", async ({ page }) => {
  await openTray(page);
  await tray(page).getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Resumed from tile 448. About 6 min left.")).toBeVisible();
  await expect(tray(page)).not.toContainText("Paused at 38%");
  await tray(page).getByRole("button", { name: "CAMELYON tumor model v1.0" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/jobs/`));
  const job = page.getByRole("dialog", { name: /CAMELYON tumor model v1.0 · running/ });
  await expect(job).toContainText(/tile \d+ of 1,180/);
});

test("a finished run opens its steps from the tray", async ({ page }) => {
  await openTray(page);
  await tray(page).getByRole("button", { name: "HoVer-Net v2.1" }).click();
  const done = page.getByRole("dialog", { name: /HoVer-Net v2.1 · done/ });
  await expect(done).toContainText("21,408 cells");
});

test("a finished run's Open link opens its project", async ({ page }) => {
  await openTray(page);
  await tray(page).getByRole("button", { name: "Open", exact: true }).last().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p09}`));
  await expect(tray(page)).toBeHidden();
});

test("a finished upload opens its project from the tray", async ({ page }) => {
  await openTray(page);
  await tray(page).getByRole("button", { name: "Upload into P09" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p09}`));
});

test("Escape closes the tray and gives focus back to the ring", async ({ page }) => {
  await openTray(page);
  await page.keyboard.press("Escape");
  await expect(tray(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Jobs, 2 running" })).toBeFocused();
});
