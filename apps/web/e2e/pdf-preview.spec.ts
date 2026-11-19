import { expect, test } from "./a11y.ts";
import {
  expectReadablePage,
  pageSvg,
  printed,
  readingPage as reading,
  stepAndZoom,
  stubPrint,
  pdfViewer as viewer,
} from "./pdf-preview-steps.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const project = "00000000-0000-4000-8003-000000000007";

test("the report opens the PDF as server pages with the file name, paper and page count", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation`);
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  await expect(page).toHaveURL(/view=pdf/);
  await expect(page).not.toHaveURL(/scene=/);
  const preview = viewer(page);
  await expect(preview.getByText("evaluation_v1_report.pdf")).toBeVisible();
  await expect(preview.getByText("A4 · portrait · 3 pages")).toBeVisible();
  await expect(preview.getByRole("img", { name: /Page \d of the report/ })).toHaveCount(3);
  await expect(preview.getByRole("group", { name: "Pages" }).getByRole("button")).toHaveCount(3);
  await expect(preview.getByRole("button", { name: "Print" })).toBeEnabled();
  await expect(preview.getByRole("button", { name: "Download" })).toBeEnabled();
});

test("the page fits the window, its text is readable and the controls step pages and zoom", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation?view=pdf`);
  const preview = viewer(page);
  const first = preview.getByRole("img", { name: "Page 1 of the report" });
  await expectReadablePage(page, first);
  expect(await pageSvg(first)).toContain("RT-14 evaluation");
  await stepAndZoom(page, 3);
});

test("the page indicator follows the scroll and a thumbnail jumps to its page", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation?view=pdf`);
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
  await page.goto(`/tasks/${rt14}/evaluation?view=pdf`);
  const preview = viewer(page);
  const first = preview.getByRole("img", { name: "Page 1 of the report" });
  await expect(first).toBeVisible();
  const zoom = preview.getByRole("status", { name: "Zoom", exact: true });
  const zoomOut = preview.getByRole("button", { name: "Zoom out" });
  const zoomIn = preview.getByRole("button", { name: "Zoom in" });
  while (await zoomOut.isEnabled()) await zoomOut.click();
  await expect(zoom).toHaveText("50%");
  expect(Math.round((await first.boundingBox())?.width ?? 0)).toBe(397);
  await zoomIn.click();
  await expect(zoom).toHaveText("75%");
  while (await zoomIn.isEnabled()) await zoomIn.click();
  await expect(zoom).toHaveText("300%");
  expect(Math.round((await first.boundingBox())?.width ?? 0)).toBe(2382);
});

test("Print sends every page of the PDF to the browser's print", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/evaluation?view=pdf`);
  const preview = viewer(page);
  await expect(preview.getByRole("img", { name: "Page 1 of the report" })).toBeVisible();
  await stubPrint(page);
  await preview.getByRole("button", { name: "Print" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  const [call] = await printed(page);
  expect(call?.pages).toBe(3);
  expect(call?.widths.every((width) => Number(width) > 500)).toBe(true);
  expect(call?.style).toContain("@page{size:210mm 297mm;margin:0}");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("[data-print-sheet]")).toHaveCount(0);
});

test("Download saves the file and Close returns to the report", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/evaluation`);
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  const preview = viewer(page);
  const saved = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download" }).click();
  expect((await saved).suggestedFilename()).toBe("evaluation_v1_report.pdf");
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page).not.toHaveURL(/view=pdf/);
});

test("the template list previews and prints the sample PDF", async ({ page }) => {
  await page.goto("/admin?section=templates");
  const row = page.getByRole("row", { name: /Sentinel node AI evaluation/ });
  await row.getByRole("button", { name: "Preview" }).click();
  const preview = viewer(page);
  await expect(preview.getByText(/Sentinel_node_AI_evaluation_sample\.pdf/)).toBeVisible();
  await expect(preview.getByText(/sample numbers/)).toBeVisible();
  const first = preview.getByRole("img", { name: /Page 1 of the report/ });
  await expectReadablePage(page, first);
  expect(await pageSvg(first)).toContain("Sentinel node AI evaluation");
  await stubPrint(page);
  await preview.getByRole("button", { name: "Print" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
});

test("the template editor previews what is on the page", async ({ page }) => {
  await page.goto("/admin?scene=tpledit");
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  const preview = viewer(page);
  await expect(preview.getByText(/_sample\.pdf/)).toBeVisible();
  await expect(preview.getByText(/sample numbers/)).toBeVisible();
  await expectReadablePage(page, preview.getByRole("img", { name: /Page 1 of the report/ }));
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
});

test("the template step of a new review task previews the report", async ({ page }) => {
  await page.goto(`/projects/${project}/tasks/new?scene=slides`);
  await page.getByRole("button", { name: "Preview the report" }).click();
  const preview = viewer(page);
  await expect(preview.getByText(/sample numbers/)).toBeVisible();
  await expectReadablePage(page, preview.getByRole("img", { name: /Page 1 of the report/ }));
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
});
