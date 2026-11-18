import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";

test.use({ viewport: { width: 1440, height: 900 } });

const live = `/projects/${p07}/slides/${tumor044}/live`;

const settings = (page: Page) => page.getByRole("dialog", { name: "Settings" });

const cameraOf = (page: Page) => page.getByTestId("slide-host").getAttribute("data-camera");

async function settledCamera(page: Page) {
  let last = await cameraOf(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(150);
      const now = await cameraOf(page);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return last;
}

test("Settings opens over the live viewer and closes back to the same camera", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(live);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const start = await cameraOf(page);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => cameraOf(page)).not.toBe(start);
  const before = await settledCamera(page);

  await page.keyboard.press("ControlOrMeta+,");
  await expect(settings(page)).toBeVisible();
  await expect(page).toHaveURL(/\/slides\/[^/]+\/live\?.*settings=display/);
  await expect(page.getByTestId("slide-host")).toBeAttached();

  await settings(page).getByRole("button", { name: "Shortcuts" }).click();
  await expect(page).toHaveURL(/settings=shortcuts/);

  await page.mouse.click(3, 3);
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/slides\/[^/]+\/live/);
  await expect(page).not.toHaveURL(/settings=/);
  expect(await settledCamera(page)).toBe(before);
});

test("Settings opens over Home and Escape closes it back to Home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await expect(settings(page)).toBeVisible();
  await expect(page).toHaveURL(/settings=display/);
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/localhost:\d+\/(\?.*)?$/);
  await expect(page).not.toHaveURL(/settings=/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a link with the settings section in the address opens Settings over the screen", async ({
  page,
}) => {
  await page.goto("/my-work?settings=privacy");
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).getByRole("heading", { name: "Privacy and session" })).toBeVisible();
  await page.reload();
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole("button", { name: "Close settings" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/my-work$/);
});

test("the settings route still opens from a link and closes by an outside click", async ({
  page,
}) => {
  await page.goto("/settings/display");
  await expect(settings(page)).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(settings(page)).toHaveCount(0);
});
