import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const networkNoise = /^(Failed to load resource|\[MSW\]|ZodError)/;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !networkNoise.test(message.text())) {
      errors.push(message.text().split("\n")[0] ?? "");
    }
  });
  return errors;
}

const badge = (page: Page) => page.getByTestId("fake-data-badge");

const runModel = (page: Page) => page.getByRole("dialog", { name: "Run a model" });

const tray = (page: Page) => page.getByRole("dialog", { name: "Jobs" });

async function openFromIndex(page: Page, label: string) {
  await page.goto("/prototype");
  await page.getByRole("link", { name: label, exact: true }).click();
}

test("every Run a model scene opens from the prototype index on fake data", async ({ page }) => {
  const errors = watchErrors(page);
  await openFromIndex(page, "Run a model · pick");
  await expect(runModel(page)).toContainText("tumor_052");
  await expect(runModel(page)).toContainText("tumor_060");
  await expect(runModel(page)).toContainText("PathoSAM + HoVer-NeXt");
  await expect(runModel(page)).toContainText("About 34 min");
  await expect(page.getByRole("button", { name: /Run on 2 slides/ })).toBeEnabled();
  await expect(badge(page)).toContainText("Fake data");

  await openFromIndex(page, "Run a model · menu");
  const models = page.getByRole("listbox", { name: "Models" });
  await expect(models).toContainText("Parfocal models");
  await expect(models).toContainText("Your lab's models");
  await expect(models.getByRole("option")).toHaveCount(4);

  await openFromIndex(page, "Run a model · lab");
  await expect(runModel(page)).toContainText("Lab HoVer-Net fork");
  await expect(runModel(page)).toContainText("which answers now in 210 ms");

  await openFromIndex(page, "Run a model · started");
  await expect(tray(page)).toContainText("PathoSAM + HoVer-NeXt v1.2");
  await expect(tray(page)).toContainText("Starting · 34 min");
  await expect(tray(page)).toContainText("Running · 2");
  expect(errors).toEqual([]);
});

test("Run starts the job, the tray shows it and its row opens the job window", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/projects/${p07}/run-model?scene=pick`);
  await expect(page.getByRole("listbox", { name: "Slides matches" })).toBeHidden();
  await page.getByRole("button", { name: /PathoSAM \+ HoVer-NeXt/ }).click();
  await page.getByRole("option", { name: /CAMELYON tumor model/ }).click();
  await expect(runModel(page)).toContainText("About 8 min, done around");
  await page.getByRole("button", { name: /Run on 2 slides/ }).click();
  await expect(runModel(page)).toBeHidden();
  await expect(tray(page)).toContainText("CAMELYON tumor model v1.0");
  await tray(page).getByRole("button", { name: "Upload into P07" }).waitFor();
  await tray(page)
    .getByRole("button", { name: /CAMELYON tumor model v1.0/ })
    .first()
    .click();
  const job = page.getByRole("dialog", { name: /running/ });
  await expect(job).toContainText("tumor_052.tif");
  await expect(job).toContainText("Tiles read");
  expect(errors).toEqual([]);
});

test("removing every slide and the run shows its blocker", async ({ page }) => {
  await page.goto(`/projects/${p07}/run-model`);
  await page.getByRole("button", { name: "Remove tumor_052" }).click();
  await page.getByRole("button", { name: "Remove tumor_060" }).click();
  await expect(runModel(page)).toContainText("Pick at least one slide.");
  await expect(page.getByRole("button", { name: /^Run/ })).toBeDisabled();
});

test("every job scene opens with its steps per slide", async ({ page }) => {
  const errors = watchErrors(page);
  await openFromIndex(page, "A job · run");
  const running = page.getByRole("dialog", { name: /PathoSAM \+ HoVer-NeXt v1.2 · running/ });
  await expect(running).toContainText("tumor_052.tif");
  await expect(running).toContainText("tumor_060.tif");
  await expect(running).toContainText("one run ahead, 8 min");
  await expect(running).toContainText("Waiting");

  await openFromIndex(page, "A job · cam");
  const paused = page.getByRole("dialog", { name: /CAMELYON tumor model v1.0 · paused/ });
  await expect(paused).toContainText("Paused at 38%: the lab server stopped answering");
  await expect(paused).toContainText("tile 448 of 1,180");
  await expect(paused).toContainText("has not answered for 12 minutes");

  await openFromIndex(page, "A job · hov");
  const done = page.getByRole("dialog", { name: /HoVer-Net v2.1 · done/ });
  await expect(done).toContainText("LN-0141.svs");
  await expect(done).toContainText("21,408 cells");
  await expect(done).toContainText("Done in 34 min");
  await expect(done.getByText("Open the slide")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the paused run resumes, and a cancelled run comes back with Undo", async ({ page }) => {
  await openFromIndex(page, "A job · cam");
  await page.getByRole("button", { name: "Resume now" }).click();
  await expect(page.getByText("Resumed from tile 448. About 6 min left.")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: /CAMELYON tumor model v1.0 · running/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel the run" }).click();
  await expect(
    page.getByText("Run cancelled. Slides that finished keep their results."),
  ).toBeVisible();
  await expect(tray(page)).toContainText("Running · 1");
  await expect(tray(page)).not.toContainText("CAMELYON tumor model v1.0");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(tray(page)).toContainText("CAMELYON tumor model v1.0");
});

test("a cancelled run stays cancelled once the 4 second Undo window has passed", async ({
  page,
}) => {
  await page.clock.install();
  await openFromIndex(page, "A job · cam");
  await page.getByRole("button", { name: "Resume now" }).click();
  await expect(
    page.getByRole("dialog", { name: /CAMELYON tumor model v1.0 · running/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel the run" }).click();
  await expect(
    page.getByText("Run cancelled. Slides that finished keep their results."),
  ).toBeVisible();
  await page.clock.fastForward(4100);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(tray(page)).not.toContainText("CAMELYON tumor model v1.0");
});

test("the ring in the top bar opens the tray from home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Jobs, 2 running" }).click();
  await expect(tray(page)).toContainText("Upload into P07");
  await expect(tray(page)).toContainText("Paused at 38%");
  await expect(tray(page)).toContainText("HoVer-Net v2.1");
});

test("the upload's end runs a model on the slides without results", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/projects/${p07}/upload?scene=done`);
  const zone = page.getByTestId("no-results-zone");
  await expect(zone).toContainText("no results");
  await zone.getByRole("button", { name: "Run a model" }).click();
  await expect(runModel(page)).toBeVisible();
  await expect(runModel(page)).toContainText("About");
  await page.getByRole("button", { name: /Run on \d+ slides?/ }).click();
  await expect(runModel(page)).toBeHidden();
  await expect(tray(page)).toContainText("Starting");
  expect(errors).toEqual([]);
});
