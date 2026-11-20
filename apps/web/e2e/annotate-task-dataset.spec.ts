import type { Page } from "@playwright/test";
import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";

test.use({ viewport: { width: 1440, height: 900 } });

async function openTask(page: Page) {
  await page.goto(`/projects/${p07}/slides/${withResults}?task=${annotateTask}&tab=objects&as=DH`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

async function signOffTheSlide(page: Page) {
  const base = `/api/review-tasks/${annotateTask}/slides/${withResults}`;
  const statuses = await page.evaluate(async (path) => {
    const checked = await fetch(`${path}/check`, { method: "POST" });
    const signed = await fetch(`${path}/sign-off`, { method: "POST" });
    return [checked.status, signed.status];
  }, base);
  expect(statuses).toEqual([200, 200]);
}

test("the Export menu offers the training dataset and the patches and downloads both", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTask(page);
  await signOffTheSlide(page);
  await page.getByTestId("export-menu").click();
  const dataset = page.getByTestId("export-training-dataset");
  const patches = page.getByTestId("export-patches");
  await expect(dataset).toContainText("Training dataset (QuPath GeoJSON zip)");
  await expect(dataset.locator("small")).not.toBeEmpty();
  await expect(patches).toContainText("Patches with masks");
  await expect(patches.locator("small")).not.toBeEmpty();
  const datasetDownload = page.waitForEvent("download");
  await dataset.click();
  expect((await datasetDownload).suggestedFilename()).toMatch(/dataset\.zip$/);

  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-patches").click();
  await page.getByTestId("patch-export-level").fill("1");
  await page.getByTestId("patch-export-tile").fill("256");
  const patchDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Cut the patches" }).click();
  await expect(page.getByTestId("patch-export-job")).toContainText("Job ");
  expect((await patchDownload).suggestedFilename()).toMatch(/patches\.zip$/);
  await expect(page.getByTestId("patch-export-job")).toContainText("The patches are ready");
});

test("a task with nothing signed off explains why both exports are refused", async ({ page }) => {
  test.setTimeout(90_000);
  await openTask(page);
  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-training-dataset").click();
  await expect(page.getByText(/No slide of this task is signed off yet/)).toBeVisible();

  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-patches").click();
  await page.getByRole("button", { name: "Cut the patches" }).click();
  await expect(page.getByTestId("patch-export-refusal")).toContainText(
    "Sign off at least one slide, then export again",
  );
});
