import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./telemetry-capture.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";
const excisionCase = "00000000-0000-4000-8004-000000000007";
const report = `/projects/${p03}/cases/${sentinelCase}/report`;
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test.setTimeout(90_000);

const flow = (page: Page) => page.getByTestId("clinical-report");
const step = (page: Page) => flow(page).locator('[aria-current="step"]');

const violationsOf = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
};

async function next(page: Page, to: RegExp) {
  await flow(page).getByRole("button", { name: "Next" }).click();
  await expect(step(page)).toHaveText(to);
}

test("Lenka fills a report from Findings to Sign out, amends it and the earlier version stays", async ({
  page,
}) => {
  await page.goto(report);
  await expect(flow(page).getByRole("heading", { name: "Clinical report" })).toBeVisible();
  await expect(step(page)).toHaveText(/Findings/);
  await expect(flow(page).getByText("3 deposits in 1 node, largest D1 at 8.0 mm")).toBeVisible();
  await expect(flow(page).getByLabel("Specimen")).toHaveValue(/Sentinel lymph nodes/);

  await next(page, /Staging/);
  await expect(flow(page).getByText("Largest, sets the category")).toBeVisible();
  await flow(page).getByRole("button", { name: "Remove D2" }).click();
  await expect(flow(page).getByText("D2 removed")).toBeVisible();
  await flow(page).getByRole("button", { name: "Undo" }).click();
  await expect(flow(page).getByText("D2 removed")).toBeHidden();

  await flow(page)
    .getByRole("radio", { name: /Micrometastasis/ })
    .click();
  await expect(flow(page).getByText("A deposit of 8.0 mm is a macrometastasis.")).toBeVisible();
  await flow(page).getByRole("radio", { name: "Absent" }).click();
  await flow(page).getByRole("button", { name: "Next" }).click();
  await expect(flow(page).getByText("Tick the box to keep this category")).toBeVisible();
  await flow(page).getByText("I confirm this category").first().click();
  await next(page, /Report text/);
  await expect(flow(page).getByText("From the slide")).toBeVisible();

  await next(page, /Sign out/);
  await expect(flow(page).getByText("Check before you sign")).toBeVisible();
  expect(await violationsOf(page)).toEqual([]);

  await flow(page).getByRole("button", { name: "Sign out", exact: true }).click();
  const sign = page.getByRole("dialog", { name: "Sign out S26-04812" });
  await sign.getByRole("button", { name: /Sign with Vltava SSO/ }).click();
  await expect(flow(page).getByText(/Signed out .* by Lenka Malá/)).toBeVisible();
  await expect(flow(page).getByRole("button", { name: "Download PDF" })).toBeVisible();

  await page.reload();
  await expect(flow(page).getByText(/Signed out .* by Lenka Malá/)).toBeVisible();

  await flow(page).getByRole("button", { name: "Amend" }).click();
  const amend = page.getByRole("dialog", { name: "Amend the report" });
  await amend.getByLabel("Reason").fill("short");
  await amend.getByRole("button", { name: /Amend and sign again/ }).click();
  await expect(amend.getByText("Give a reason of at least 10 characters.")).toBeVisible();
  await amend.getByLabel("Reason").fill("Measured again on a deeper level of A2");
  await amend.getByRole("button", { name: /Amend and sign again/ }).click();
  await expect(flow(page).getByText("AMENDED REPORT")).toBeVisible();

  await page.reload();
  await expect(flow(page).getByText("AMENDED REPORT")).toBeVisible();
  await flow(page).getByRole("button", { name: "Open v1" }).click();
  await expect(flow(page).getByText("Final report, version 1")).toBeVisible();
});

test("Next on Staging asks for the answers that are still missing", async ({ page }) => {
  await page.goto(report);
  await next(page, /Staging/);
  await next(page, /Staging/);
  await expect(flow(page).getByText("Pick one. Not assessed is an answer too.")).toBeVisible();
});

test("a template without Staging has three steps and no deposits", async ({ page }) => {
  await page.goto(`/projects/${p03}/cases/${excisionCase}/report`);
  await expect(flow(page).getByRole("heading", { name: "Clinical report" })).toBeVisible();
  const steps = flow(page).getByRole("list").first().getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(flow(page).getByText("Staging")).toHaveCount(0);
  await next(page, /Report text/);
  await expect(flow(page).getByText(/REACTIVE FOLLICULAR HYPERPLASIA/)).toBeVisible();
  expect(await violationsOf(page)).toEqual([]);
});

test("a deposit added by hand shows in Staging and passes axe", async ({ page }) => {
  await page.goto(report);
  await next(page, /Staging/);
  await flow(page).getByRole("button", { name: "Add a deposit" }).click();
  const add = page.getByRole("dialog", { name: "Add a deposit" });
  await expect(add).toBeVisible();
  expect(await violationsOf(page)).toEqual([]);
  await add.getByRole("radio", { name: "Measured by hand" }).click();
  await add.getByRole("textbox", { name: "Size" }).fill("1.5");
  await add.getByRole("radio", { name: "mm" }).click();
  await add.locator('[aria-labelledby="dep-slide-label"]').click();
  await page.getByRole("option").first().click();
  await add.getByRole("button", { name: /Add the deposit/ }).click();
  await expect(page.getByText(/D4 added/)).toBeVisible();
  await expect(
    flow(page)
      .getByText(/measured by hand/)
      .first(),
  ).toBeVisible();
});
