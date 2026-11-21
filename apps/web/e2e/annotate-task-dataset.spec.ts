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
  await expect(page.getByTestId("patch-export-format")).toContainText("Class masks");
  await page.getByRole("radio", { name: "Masks and COCO" }).click();
  const polls: { url: string; status: number }[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/patch-exports/"))
      polls.push({ url: response.url(), status: response.status() });
  });
  const patchDownload = page.waitForEvent("download");
  const patchRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/patch-exports"),
  );
  await page.getByRole("button", { name: "Cut the patches" }).click();
  expect((await patchRequest).postDataJSON()).toMatchObject({ format: "coco", level: 1 });
  await expect(page.getByTestId("patch-export-job")).toContainText("Job ");
  expect((await patchDownload).suggestedFilename()).toMatch(/patches\.zip$/);
  await expect(page.getByTestId("patch-export-job")).toContainText("The patches are ready");
  const statusCalls = () => polls.filter((poll) => poll.url.endsWith("/status")).length;
  const settled = statusCalls();
  await page.waitForTimeout(3_500);
  expect(statusCalls()).toBe(settled);
  expect(settled).toBeGreaterThan(0);
  expect(polls.filter((poll) => poll.status !== 200)).toEqual([]);
});

test("the owner sees who still has to check, signs the slide off in the viewer and reaches the dataset", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTask(page);
  const card = page.getByRole("region", { name: "Sign off" });
  const signOff = card.getByRole("button", { name: "Sign off", exact: true });
  await expect(card).toContainText("has not checked this slide yet");
  await expect(signOff).toBeDisabled();
  await page
    .getByTestId("live-top-bar")
    .getByRole("button", { name: "Mark slide checked" })
    .click();
  await expect(page.getByTestId("annotate-task-panel")).toHaveAttribute("data-step", "checked");
  await expect(card).not.toContainText("has not checked this slide yet");
  await signOff.click();
  await expect(page.getByTestId("annotate-task-panel")).toHaveAttribute("data-step", "signed-off");
  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-dataset-page").click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${annotateTask}/dataset`));
  await expect(page.getByTestId("dataset-total")).toContainText("on 1 slide");
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
