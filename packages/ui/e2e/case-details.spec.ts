import { expect, type Page, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-review-popovers--${name}&viewMode=story&globals=a11y.manual:!true`;

const field = (page: Page, name: string) => page.locator(`[data-field="${name}"] dd`);

test("the slide picker shows each case detail of a de-identified project", async ({ page }) => {
  await page.goto(story("slides-in-case"));
  const popover = page.getByRole("dialog", { name: "Slides in this case and task" });
  const details = popover.getByLabel("Case details");
  await expect(details).toBeVisible();
  await expect(field(page, "project")).toHaveText("Sentinel node AI evaluation");
  await expect(field(page, "case")).toHaveText("S26-04812");
  await expect(field(page, "specimen")).toHaveText("A · Lymph node, sentinel, left");
  await expect(field(page, "blocks")).toHaveText("A1, A2");
  await expect(field(page, "task")).toHaveText("RT-14 · Round 2 · CAMELYON v1.0");
  await expect(field(page, "researcher")).toHaveText("Demo Researcher");
  await expect(page.locator('[data-field="clinical-note"]')).toHaveCount(0);
  await expect(details.locator("[data-missing]")).toHaveCount(0);
});

test("a clinical project adds the clinical note", async ({ page }) => {
  await page.goto(story("case-details-clinical"));
  await expect(page.getByRole("term").filter({ hasText: "Clinical note" })).toBeVisible();
  await expect(field(page, "clinical-note")).toHaveText(
    "Fake note for the demo. Lesion growing over three months.",
  );
  await expect(field(page, "blocks")).toHaveText("A1");
});

test("each missing detail says so instead of staying blank", async ({ page }) => {
  await page.goto(story("case-details-missing"));
  const expected: [string, string][] = [
    ["project", "Not known"],
    ["case", "No case attached"],
    ["specimen", "Not recorded"],
    ["blocks", "No blocks recorded"],
    ["task", "Not part of a task"],
    ["researcher", "Not known"],
    ["clinical-note", "No clinical note"],
  ];
  for (const [name, text] of expected) {
    await expect(field(page, name)).toHaveText(text);
    await expect(field(page, name)).toHaveAttribute("data-missing", "true");
  }
});
