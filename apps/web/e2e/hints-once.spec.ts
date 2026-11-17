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
