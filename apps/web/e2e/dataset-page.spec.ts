import { readFile } from "node:fs/promises";
import type { Download, Page } from "@playwright/test";
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

async function bytesOf(download: Download) {
  const path = await download.path();
  return readFile(path);
}

test("the dataset page filters its counts, freezes a version and gives it back byte for byte", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTask(page);
  await signOffTheSlide(page);
  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-dataset-page").click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${annotateTask}/dataset`));
  const total = page.getByTestId("dataset-total");
  await expect(total).toHaveText("11 objects on 1 slide");
  await expect(page.getByTestId("dataset-left-out")).toContainText("4 not checked");

  await page.getByTestId("filter-origin-ai-confirmed").click();
  await expect(total).toHaveText("6 objects on 1 slide");
  await page.getByTestId("filter-include-unchecked").click();
  await expect(total).toHaveText("10 objects on 1 slide");
  await expect(page.getByTestId("dataset-count-ai-unchecked")).toContainText("4");
  await page.getByTestId("filter-class-1").click();
  await expect(total).toHaveText("6 objects on 1 slide");
  await page.getByTestId("filter-class-1").click();
  await page.getByTestId("filter-include-unchecked").click();
  await expect(total).toHaveText("6 objects on 1 slide");

  await expect(page.getByTestId("dataset-no-versions")).toBeVisible();
  await page.getByTestId("dataset-note").fill("Edited and added only");
  await page.getByTestId("dataset-freeze").click();
  const version = page.getByTestId("dataset-version-1");
  await expect(version).toContainText("Edited and added only");
  await expect(version).toContainText("6 objects on 1 slide");
  await expect(version).toContainText("SHA-256");

  const first = page.waitForEvent("download");
  await page.getByTestId("dataset-version-1-download").click();
  const firstDownload = await first;
  expect(firstDownload.suggestedFilename()).toMatch(/dataset-v1\.zip$/);
  const second = page.waitForEvent("download");
  await page.getByTestId("dataset-version-1-download").click();
  expect((await bytesOf(await second)).equals(await bytesOf(firstDownload))).toBe(true);

  await page.getByTestId("dataset-version-1-patches").click();
  await expect(page.getByRole("dialog")).toContainText("Patches of version 1");
  const patches = page.waitForEvent("download");
  await page.getByRole("button", { name: "Cut the patches" }).click();
  expect((await patches).suggestedFilename()).toMatch(/patches\.zip$/);
  await expect(page.getByTestId("patch-export-job")).toContainText("The patches are ready");
});

test("the dataset page explains that nothing is signed off yet", async ({ page }) => {
  await page.goto(`/tasks/${annotateTask}/dataset?as=DH`);
  await expect(page.getByTestId("dataset-refusal")).toContainText(
    "No slide of this task is signed off yet",
  );
});
