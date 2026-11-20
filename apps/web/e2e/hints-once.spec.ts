import { expect, type Page, test } from "./a11y.ts";

const guidedItem = (page: Page) =>
  page
    .getByRole("region", { name: "Getting started" })
    .getByRole("button", { name: "Review one slide in guided review" });

test("old one-off hint keys fold into the hints list and Show all hints again brings them back", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("seeded") !== null) return;
    window.sessionStorage.setItem("seeded", "1");
    window.localStorage.setItem("parfocal.checklist-tried", '["guided-review"]');
    window.localStorage.setItem("parfocal.tool-hints-seen", '["ruler"]');
    window.localStorage.setItem("parfocal.guided-coach", '{"guest": true}');
  });
  await page.goto("/?scene=new");
  const checklist = page.getByRole("region", { name: "Getting started" });
  await expect(checklist).toBeVisible({ timeout: 20_000 });
  await expect(guidedItem(page)).toHaveCount(0);

  const oldKeys = await page.evaluate(() => [
    window.localStorage.getItem("parfocal.checklist-tried"),
    window.localStorage.getItem("parfocal.tool-hints-seen"),
    window.localStorage.getItem("parfocal.guided-coach"),
  ]);
  expect(oldKeys).toEqual([null, null, null]);

  await page.goto("/?scene=new");
  await expect(checklist).toBeVisible({ timeout: 20_000 });
  await expect(guidedItem(page)).toHaveCount(0);

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  await palette.getByRole("combobox").fill("hints again");
  await expect(palette.getByRole("option").first()).toHaveText(/Show all hints again/);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/api/me/setting-layers") && response.request().method() === "PUT",
  );
  await page.keyboard.press("Enter");
  await saved;
  await expect(palette).toHaveCount(0);

  await page.goto("/?scene=new");
  await expect(guidedItem(page)).toBeVisible({ timeout: 20_000 });
});

test("opening a slide writes no setting, and closing a tool hint is what marks it seen", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/me/setting-layers") && request.method() !== "GET") {
      writes.push(request.postData() ?? "");
    }
  });
  const project = "00000000-0000-4000-8003-000000000007";
  const slide = "00000000-0000-4000-8005-000000000005";
  for (const mode of ["review", "annotate"]) {
    await page.goto(`/projects/${project}/slides/${slide}?mode=${mode}`);
    const stage = page.getByTestId("slide-stage");
    await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(stage).toHaveAttribute("data-annotations", "loaded");
    await page.waitForLoadState("networkidle");
  }
  await expect(page.getByTestId("hint-close")).toBeVisible();
  const modes = page.getByTestId("mode-switch");
  await modes.getByRole("radio", { name: "Look" }).click();
  await expect(page.getByTestId("hint-close")).toHaveCount(0);
  await modes.getByRole("radio", { name: "Annotate" }).click();
  await expect(page.getByTestId("hint-close")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(writes).toEqual([]);
  await page.getByTestId("hint-close").click();
  await expect.poll(() => writes.length).toBeGreaterThan(0);
});

test("going back and forth between two tools writes each tool hint once", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/me/setting-layers") && request.method() !== "GET") {
      writes.push(request.postData() ?? "");
    }
  });
  const project = "00000000-0000-4000-8003-000000000007";
  const slide = "00000000-0000-4000-8005-000000000005";
  await page.goto(`/projects/${project}/slides/${slide}?mode=annotate`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(page.getByTestId("hint-close")).toBeVisible();
  await stage.click({ position: { x: 20, y: 20 } });
  for (const key of ["h", "v", "h", "v", "h", "v"]) {
    await page.keyboard.press(key);
    await page.waitForLoadState("networkidle");
  }
  expect(writes).toHaveLength(2);
});
