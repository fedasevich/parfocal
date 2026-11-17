import { expect, type Locator, type Page, test } from "./a11y.ts";
import { addVirtualAuthenticator } from "./virtual-authenticator.ts";

async function objectsTabHref(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = await link.getAttribute("href");
  if (href === null) throw new Error("no Full viewer · Objects tab link");
  return href;
}

async function viewBoxOf(still: Locator) {
  const value = (await still.getAttribute("viewBox")) ?? "";
  return value.split(" ").map(Number);
}

async function expectSameCamera(page: Page, still: Locator, before: number[]) {
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      const after = await viewBoxOf(still);
      if (after.length !== before.length) return Number.POSITIVE_INFINITY;
      return Math.max(...after.map((value, index) => Math.abs(value - (before[index] ?? 0))));
    })
    .toBeLessThan(0.5);
}

test("a locked slide unlocks to the same camera position", async ({ page }) => {
  await page.clock.install();
  const href = await objectsTabHref(page);
  await page.goto(href);
  const still = page.getByTestId("full-viewer").getByRole("img", { name: "The whole slide" });
  await expect(still).toBeVisible();

  const home = await viewBoxOf(still);
  const box = await still.boundingBox();
  if (box === null) throw new Error("the slide has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -120);
  await page.mouse.down();
  await page.mouse.move(centre.x - 140, centre.y - 90, { steps: 5 });
  await page.mouse.up();
  await page.clock.runFor(1_000);
  await expect(page).toHaveURL(/[?&]z=/);
  const before = await viewBoxOf(still);
  const lockedAt = page.url();
  expect(before).not.toEqual(home);

  await page.clock.fastForward("16:00");
  const lock = page.getByRole("region", { name: "Locked" });
  await expect(lock).toBeVisible();
  await expect(lock).toContainText("Locked after 15 minutes without input");

  await lock.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(lock).toBeHidden();
  await expect(page).toHaveURL(lockedAt);
  await expect(still).toBeVisible();
  await expectSameCamera(page, still, before);
});

test("locking from the account menu unlocks to the same camera position", async ({ page }) => {
  await page.clock.install();
  const href = await objectsTabHref(page);
  await page.goto(href);
  const still = page.getByTestId("full-viewer").getByRole("img", { name: "The whole slide" });
  await expect(still).toBeVisible();
  const box = await still.boundingBox();
  if (box === null) throw new Error("the slide has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -120);
  await page.mouse.down();
  await page.mouse.move(centre.x - 140, centre.y - 90, { steps: 5 });
  await page.mouse.up();
  await page.clock.runFor(1_000);
  await expect(page).toHaveURL(/[?&]z=/);
  const before = await viewBoxOf(still);
  const lockedAt = page.url();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^Lock the screen/ }).click();
  const lock = page.getByRole("region", { name: "Locked" });
  await expect(lock).toBeVisible();
  await expect(lock).toContainText("You locked the screen");

  await lock.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(lock).toBeHidden();
  await expect(page).toHaveURL(lockedAt);
  await expectSameCamera(page, still, before);
});

test("a passkey unlocks a locked slide to the same camera position", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  await authenticator.saveCredential();
  await page.clock.install();
  const href = await objectsTabHref(page);
  await page.goto(href);
  const still = page.getByTestId("full-viewer").getByRole("img", { name: "The whole slide" });
  await expect(still).toBeVisible();
  const box = await still.boundingBox();
  if (box === null) throw new Error("the slide has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -120);
  await page.mouse.down();
  await page.mouse.move(centre.x - 140, centre.y - 90, { steps: 5 });
  await page.mouse.up();
  await page.clock.runFor(1_000);
  await expect(page).toHaveURL(/[?&]z=/);
  const before = await viewBoxOf(still);
  const lockedAt = page.url();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^Lock the screen/ }).click();
  const lock = page.getByRole("region", { name: "Locked" });
  await expect(lock).toBeVisible();

  const started = page.waitForRequest((request) =>
    request.url().endsWith("/api/auth/passkey-sign-in"),
  );
  await lock.getByRole("button", { name: "Unlock with a passkey" }).click();
  const body = (await started).postDataJSON() as { email: string };
  expect(body.email).toMatch(/@/);
  await expect(lock).toBeHidden();
  await expect(page).toHaveURL(lockedAt);
  await expectSameCamera(page, still, before);
});
