import { readFile } from "node:fs/promises";
import type { AuditExport } from "@parfocal/api-client";
import { expect, type Page, test } from "./a11y.ts";

const pick = async (page: Page, chip: RegExp, option: string) => {
  await page.getByRole("button", { name: chip }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const rows = (page: Page) => page.getByRole("table").getByRole("row");

test("the audit log filters by person, time, project and action, then exports what it shows", async ({
  page,
}) => {
  await page.goto("/admin?section=audit");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("7 events")).toBeVisible();
  await expect(page.getByText("Rejected a call with a bad signature")).toBeVisible();

  await pick(page, /^Person: Everyone/, "Daniel Hruška");
  await expect(page.getByText("3 events")).toBeVisible();
  await expect(rows(page)).toHaveCount(4);

  await pick(page, /^Person: Daniel Hruška/, "Any person");
  await pick(page, /^Time: Today/, "Last 30 days");
  await expect(page.getByRole("heading", { name: "Last 30 days" })).toBeVisible();
  await expect(page.getByText("9 events")).toBeVisible();

  await pick(page, /^Project: All projects/, "Lymph nodes 2026 P03");
  await expect(page.getByText("2 events")).toBeVisible();

  await pick(page, /^Action: All actions/, "People and roles");
  await expect(page.getByText("1 event", { exact: true })).toBeVisible();
  await expect(rows(page).nth(1)).toContainText("Changed a role");
  await expect(rows(page).nth(1)).toContainText("P03");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export signed log" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^parfocal-audit-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile(String(await file.path()), "utf8")) as AuditExport;
  expect(exported.format).toBe("parfocal-audit-export");
  expect(exported.signature.algorithm).toBe("Ed25519");
  expect(exported.events).toHaveLength(1);
  expect(exported.events[0]?.action).toBe("member.role-changed");
  expect(exported.filters).toMatchObject({ action_prefix: "member." });
  expect(Object.keys(exported.filters)).toEqual(
    expect.arrayContaining(["project_id", "since", "action_prefix"]),
  );
  await expect(page.getByText(/Exported 1 event, signed with/)).toBeVisible();
});

test("the audit log never shows the free text an event carries", async ({ page }) => {
  await page.goto("/admin?section=audit");
  await expect(page.getByText("7 events")).toBeVisible();
  await expect(page.getByText("Signed off a task")).toBeVisible();
  await expect(page.getByText("Signed off RT-09, Evaluation v1")).toHaveCount(0);
});
