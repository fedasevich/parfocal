import { expect, type Page, test } from "./a11y.ts";

const tray = (page: Page) => page.getByRole("dialog", { name: "Jobs" });

async function showTray(page: Page) {
  await expect(tray(page).and(page.locator("[data-closed]"))).toHaveCount(0);
  if ((await tray(page).count()) === 0) {
    await page.getByRole("button", { name: /^Jobs/ }).click();
  }
  await expect(tray(page)).toBeVisible();
}

async function openFromIndex(page: Page, label: string) {
  await page.goto("/prototype");
  await page.getByRole("link", { name: label, exact: true }).click();
}

const rowOf = (page: Page, file: string) =>
  page.locator('[data-slot="job-slide-row"]').filter({ hasText: file });

test("a running job shows one bar, each slide with its steps and a waiting second slide", async ({
  page,
}) => {
  await openFromIndex(page, "A job · run");
  const job = page.getByRole("dialog", { name: /PathoSAM \+ HoVer-NeXt v1.2 · running/ });
  await expect(job).toContainText("Starting · about 34 min");
  const first = rowOf(page, "tumor_052.tif");
  await expect(first).toHaveAttribute("data-open", "true");
  const steps = first.locator('[data-slot="job-step-list"] [data-state]');
  await expect(steps).toHaveText([
    /Queued/,
    /Tiles read/,
    /Tissue found/,
    /Model running/,
    /Objects placed/,
    /IDs given/,
    /Result set added/,
  ]);
  await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
  await expect(steps.nth(1)).toHaveAttribute("data-state", "current");
  await expect(steps.nth(2)).toHaveAttribute("data-state", "waiting");
  await expect(first.getByRole("link", { name: /Open/ })).toHaveCount(0);

  const second = rowOf(page, "tumor_060.tif");
  await expect(second).toContainText("Waiting");
  await expect(second).toContainText("0 of 7");
  await second.getByRole("button", { name: /0 of 7/ }).click();
  await expect(second.locator('[data-state="waiting"]')).toHaveCount(7);
});

test("closing a running job keeps it in the tray, still running", async ({ page }) => {
  await openFromIndex(page, "A job · run");
  await page.getByRole("button", { name: "Close, it keeps going" }).click();
  await expect(page.getByRole("dialog", { name: /running/ })).toHaveCount(0);
  await showTray(page);
  await expect(tray(page)).toContainText("PathoSAM + HoVer-NeXt v1.2");
  await expect(tray(page)).toContainText("Starting · 34 min");
});

test("a paused job says why and moves to the Parfocal GPU from the same tile", async ({ page }) => {
  await openFromIndex(page, "A job · cam");
  const job = page.getByRole("dialog", { name: /CAMELYON tumor model v1.0 · paused/ });
  await expect(job).toContainText("Paused at 38%: the lab server stopped answering");
  await expect(job).toContainText("Nothing is lost");
  await expect(job.getByRole("button", { name: "Resume now" })).toBeVisible();
  const row = page.locator('[data-slot="job-slide-row"]').first();
  const model = row.locator('[data-state="held"]');
  await expect(model).toContainText("Model running");
  await expect(model).toContainText("tile 448 of 1,180");
  await expect(model).toContainText("paused");
  await expect(row.getByRole("link", { name: /Open/ })).toHaveCount(0);

  await job.getByRole("button", { name: "Move it to the Parfocal GPU" }).click();
  await expect(
    page.getByText(/Moved to the Parfocal GPU. It picks up from tile 448/),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: /CAMELYON tumor model v1.0 · running/ }),
  ).toBeVisible();
});

test("a finished job lists every slide done and opens a slide", async ({ page }) => {
  await openFromIndex(page, "A job · hov");
  const job = page.getByRole("dialog", { name: /HoVer-Net v2.1 · done/ });
  await expect(job).toContainText("Done in 34 min");
  await expect(job.getByRole("button", { name: "Cancel the run" })).toHaveCount(0);
  await expect(job.locator('button:text-is("Close")')).toBeVisible();
  await expect(job.getByText("Open the project")).toBeVisible();
  const rows = page.locator('[data-slot="job-slide-row"]');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("7 of 7");
  await expect(rows.first().locator('[data-state="done"]')).toHaveCount(7);
  await rows.first().getByText("Open the slide").click();
  await expect(page).toHaveURL(/\/slides\//);
});

test("cancelling a run stops every unfinished slide and Undo brings the run back", async ({
  page,
}) => {
  await openFromIndex(page, "A job · run");
  await page.getByRole("button", { name: "Cancel the run" }).click();
  await expect(
    page.getByText("Run cancelled. Slides that finished keep their results."),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: /running/ })).toHaveCount(0);
  await showTray(page);
  await expect(tray(page)).toContainText("Upload into P07");
  await expect(tray(page)).not.toContainText("tumor_052 and tumor_060");
  await page.getByRole("button", { name: "Undo" }).click();
  await showTray(page);
  await expect(tray(page)).toContainText("tumor_052 and tumor_060");
});
