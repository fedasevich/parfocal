import { expect, type Page, test } from "./a11y.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";

function watchWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.includes("/api/") || request.method() === "GET") return;
    if (url.pathname.endsWith("/api/auth/activity")) return;
    writes.push(`${request.method()} ${url.pathname}`);
  });
  return writes;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

test("walking through every Preferences section writes nothing", async ({ page }) => {
  await page.goto("/settings/display");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  const nav = dialog(page).getByRole("navigation", { name: "Settings sections" });
  await expect(nav).toBeVisible();
  const sections = await nav.getByRole("button").allInnerTexts();
  expect(sections.length).toBeGreaterThan(5);
  const writes = watchWrites(page);
  for (const section of [...sections, sections[0] ?? "Display"]) {
    await nav.getByRole("button", { name: section.trim(), exact: true }).click();
    await expect(dialog(page).getByRole("heading", { name: section.trim() })).toBeVisible();
  }
  await page.waitForLoadState("networkidle");
  expect(writes).toEqual([]);

  await nav.getByRole("button", { name: "Layout", exact: true }).click();
  const tools = dialog(page)
    .locator('[data-slot="settings-row"]')
    .filter({ has: page.getByRole("radiogroup", { name: "Tools", exact: true }) });
  await expect(tools.locator('[data-slot="setting-note"]')).toHaveCount(0);
  await page.reload();
  await expect(tools.locator('[data-slot="setting-note-trigger"]')).toBeVisible();
  expect(writes).toEqual([]);
});

test("opening a draft report and leaving it unchanged writes nothing", async ({ page }) => {
  await page.clock.install();
  const writes = watchWrites(page);
  await page.goto(`/projects/${p03}/cases/${sentinelCase}/report`);
  await expect(page.getByRole("heading", { name: "Clinical report" })).toBeVisible();
  await page.clock.runFor(2_000);
  expect(writes).toEqual([]);
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Lymph nodes 2026" })
    .click();
  await expect(page).not.toHaveURL(/\/report/);
  await page.clock.runFor(2_000);
  expect(writes).toEqual([]);
});

test("a kept draft edit that never reached the server is saved on the next open", async ({
  page,
}) => {
  await page.clock.install();
  const writes = watchWrites(page);
  await page.goto(`/projects/${p03}/cases/${sentinelCase}/report`);
  const specimen = page.getByRole("textbox", { name: "Specimen" });
  await expect(specimen).toBeVisible();
  await specimen.fill("Sentinel lymph node #1, left axilla, excision");
  await page.reload();
  await expect(specimen).toHaveValue("Sentinel lymph node #1, left axilla, excision");
  await page.clock.runFor(2_000);
  await expect
    .poll(() => writes.filter((write) => write.startsWith("PATCH")).length)
    .toBeGreaterThan(0);
});
