import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const project = "00000000-0000-4000-8003-000000000007";

const viewer = (page: Page) => page.getByRole("dialog", { name: "PDF preview" });
const reading = (page: Page) => viewer(page).getByLabel("Current page");

test("the report opens the PDF as server pages with the file name, paper and page count", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation?scene=report`);
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  await expect(page).toHaveURL(/scene=pdf/);
  const preview = viewer(page);
  await expect(preview.getByText("evaluation_v1_report.pdf")).toBeVisible();
  await expect(preview.getByText("A4 · portrait · 3 pages")).toBeVisible();
  await expect(preview.getByRole("img", { name: /Page \d of the report/ })).toHaveCount(3);
  await expect(preview.getByRole("group", { name: "Pages" }).getByRole("button")).toHaveCount(3);
  await expect(preview.getByRole("button", { name: "Print" })).toBeEnabled();
  await expect(preview.getByRole("button", { name: "Download" })).toBeEnabled();
});

test("the page indicator follows the scroll and a thumbnail jumps to its page", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation?scene=pdf`);
  const preview = viewer(page);
  await expect(preview.getByRole("img", { name: "Page 3 of the report" })).toBeVisible();
  await expect(reading(page)).toHaveText("1 / 3");
  await expect(preview.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await preview.getByRole("img", { name: "Page 3 of the report" }).scrollIntoViewIfNeeded();
  await expect(reading(page)).toHaveText("3 / 3");
  await expect(preview.getByRole("button", { name: "Page 3", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await preview.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(reading(page)).toHaveText("2 / 3");
  const box = await preview.getByRole("img", { name: "Page 2 of the report" }).boundingBox();
  const frame = await preview.getByRole("group", { name: "Pages" }).boundingBox();
  expect(Math.abs((box?.y ?? 0) - ((frame?.y ?? 0) + 16))).toBeLessThan(40);
});

test("zoom changes the page size and stops at its limits", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/evaluation?scene=pdf`);
  const preview = viewer(page);
  const first = preview.getByRole("img", { name: "Page 1 of the report" });
  await expect(first).toBeVisible();
  const zoom = preview.getByRole("status", { name: "Zoom", exact: true });
  await expect(zoom).toHaveText("100%");
  const full = (await first.boundingBox())?.width ?? 0;
  await preview.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toHaveText("125%");
  expect((await first.boundingBox())?.width ?? 0).toBeGreaterThan(full * 1.2);
  for (let step = 0; step < 6; step++) {
    await preview.getByRole("button", { name: "Zoom out" }).click();
  }
  await expect(zoom).toHaveText("50%");
  expect((await first.boundingBox())?.width ?? 0).toBeLessThan(full * 0.6);
});

test("Download saves the file and Close returns to the report", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/evaluation?scene=report`);
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  const preview = viewer(page);
  const saved = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download" }).click();
  expect((await saved).suggestedFilename()).toBe("evaluation_v1_report.pdf");
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page).not.toHaveURL(/scene=pdf/);
});

test("the template list previews the sample PDF", async ({ page }) => {
  await page.goto("/admin?section=templates");
  const row = page.getByRole("row", { name: /Sentinel node AI evaluation/ });
  await row.getByRole("button", { name: "Preview" }).click();
  const preview = viewer(page);
  await expect(preview.getByText(/Sentinel_node_AI_evaluation_sample\.pdf/)).toBeVisible();
  await expect(preview.getByText(/sample numbers/)).toBeVisible();
  await expect(preview.getByRole("img", { name: /Page 1 of the report/ })).toBeVisible();
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
});

test("the template editor previews what is on the page", async ({ page }) => {
  await page.goto("/admin?scene=tpledit");
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  const preview = viewer(page);
  await expect(preview.getByText(/_sample\.pdf/)).toBeVisible();
  await expect(preview.getByText(/sample numbers/)).toBeVisible();
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
});

test("the template step of a new review task previews the report", async ({ page }) => {
  await page.goto(`/projects/${project}/tasks/new?scene=slides`);
  await page.getByRole("button", { name: "Preview the report" }).click();
  const preview = viewer(page);
  await expect(preview.getByText(/sample numbers/)).toBeVisible();
  await expect(preview.getByRole("img", { name: /Page 1 of the report/ })).toBeVisible();
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
});
