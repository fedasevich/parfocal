import { expect, type Page, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-models-and-jobs--${name}&viewMode=story&globals=a11y.manual:!true`;

const tray = (page: Page) => page.locator("[data-slot=jobs-tray]");

test("the ring shows how many are running and fills with their progress", async ({ page }) => {
  await page.goto(story("rings"));
  const idle = page.getByRole("button", { name: "Jobs, 0 running" });
  await expect(idle).toHaveCount(0);
  const busy = page.getByRole("button", { name: "Jobs, 2 running" });
  await expect(busy).toHaveCount(2);
  await expect(busy.first()).toHaveAttribute("aria-expanded", "false");
  await expect(busy.first().getByRole("img", { name: "2 running, 21%" })).toContainText("2");
  await expect(busy.nth(1)).toHaveAttribute("aria-expanded", "true");
});

test("running, paused and finished rows each say where they are", async ({ page }) => {
  await page.goto(story("tray-before-a-run"));
  await expect(tray(page).getByText("Running · 2")).toBeVisible();
  await expect(tray(page).getByText("Finished")).toBeVisible();
  const upload = tray(page).getByRole("progressbar", { name: "6 slides and 4 result files" });
  await expect(upload).toHaveAttribute("aria-valuenow", "46");
  await expect(upload).toHaveAttribute("aria-valuetext", "46% · 3 min left");
  const paused = tray(page).getByRole("progressbar", {
    name: "tumor_044 · the lab server is busy",
  });
  await expect(paused).toHaveAttribute("aria-valuetext", "Paused at 38%");
  await expect(tray(page).getByRole("button", { name: "Resume" })).toBeVisible();
  const done = tray(page).getByRole("progressbar", { name: "4 slides in P09 · yesterday" });
  await expect(done).toHaveAttribute("aria-valuenow", "100");
  await expect(done).toHaveAttribute("aria-valuetext", "Done");
  await expect(tray(page).getByRole("button", { name: "Open", exact: true })).toHaveCount(2);
  await expect(tray(page)).toContainText("Jobs keep going when you close the tab");
});

test("with nothing running the tray says so and still lists what finished", async ({ page }) => {
  await page.goto(story("tray-nothing-running"));
  await expect(tray(page).getByText("Running · 0")).toBeVisible();
  await expect(tray(page).getByText("Nothing running")).toBeVisible();
  await expect(
    tray(page).getByRole("progressbar", { name: "4 slides in P09 · yesterday" }),
  ).toBeVisible();
});

test("an import, a failed upload and a cancelled run read as their own states", async ({
  page,
}) => {
  await page.goto(story("tray-with-problems"));
  await expect(tray(page).getByText("Running · 1")).toBeVisible();
  const failed = tray(page).getByRole("progressbar", {
    name: "tumor_044.czi is not supported · today 09:40",
  });
  await expect(failed).toHaveAttribute("aria-valuetext", "Failed");
  await expect(tray(page)).toContainText("tumor_044.czi is not supported");
  const cancelled = tray(page).getByRole("progressbar", { name: "2 slides in P09 · yesterday" });
  await expect(cancelled).toHaveAttribute("aria-valuetext", "Cancelled");
  await expect(tray(page).getByRole("progressbar", { name: "3 slides from a link" })).toBeVisible();
});

test("a row opens its steps, and its link opens the project", async ({ page }) => {
  await page.goto(story("tray-opening"));
  const opened = page.getByRole("status", { name: "Opened" });
  await expect(opened).toHaveText("nothing");
  await tray(page).getByRole("button", { name: "Upload into P07" }).click();
  await expect(opened).toHaveText("upload");
  await tray(page).getByRole("button", { name: "HoVer-Net v2.1" }).click();
  await expect(opened).toHaveText("run");
  await tray(page).getByRole("button", { name: "Open", exact: true }).click();
  await expect(opened).toHaveText("project");
});
