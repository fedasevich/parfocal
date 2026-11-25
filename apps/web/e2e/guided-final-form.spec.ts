import { expect, type Locator, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 150_000 });

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const question = "Is the AI result acceptable for this slide?";
const rating = (scope: Page | Locator) =>
  scope.getByRole("radiogroup", { name: question }).getByRole("radio", { name: "4" });

const objects = (page: Page) => page.getByTestId("stage-review-objects");
const form = (page: Page) => page.getByTestId("stage-opinion");
const back = (page: Page) => page.getByTestId("stage-opinion-back");

async function openStage(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  await expect(objects(page)).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await page.getByRole("button", { name: "Got it, start" }).click();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function agreeUntilForm(page: Page) {
  for (let step = 0; step < 120; step += 1) {
    if (await form(page).isVisible()) return;
    await page.keyboard.press("k");
  }
  await expect(form(page)).toBeVisible();
}

test("the deployed guided review opens the form as soon as the last object is decided", async ({
  page,
}) => {
  await openStage(page);
  await agreeUntilForm(page);
  await expect(form(page)).toBeVisible();
  await expect(form(page).getByText(/is still open/)).toHaveCount(0);
  await expect(back(page).getByRole("group", { name: "Objects" })).toBeVisible();
  await expect(
    back(page).locator('[aria-label="Objects"] button[title$="not answered yet"]'),
  ).toHaveCount(0);
});

test("the form goes back to an object, and comes back with its answers kept", async ({ page }) => {
  await openStage(page);
  await agreeUntilForm(page);
  await rating(form(page)).click();
  await expect(rating(form(page))).toBeChecked();

  const backButton = back(page).getByRole("button", { name: /^Back to / });
  const last = ((await backButton.innerText()).match(/Back to (\S+)/) ?? [])[1] ?? "";
  expect(last).not.toBe("");
  await backButton.click();
  await expect(form(page)).toHaveCount(0);
  await expect(objects(page)).toHaveAttribute("data-current", last);

  await page.keyboard.press("u");
  await expect(form(page)).toBeVisible();
  await expect(rating(form(page))).toBeChecked();
});

test("J and Shift+J leave the form and the last J comes back to it", async ({ page }) => {
  await openStage(page);
  await agreeUntilForm(page);
  const last = (await objects(page).getAttribute("data-current")) ?? "";
  await page.keyboard.press("Shift+j");
  await expect(form(page)).toHaveCount(0);
  await expect(objects(page)).toHaveAttribute("data-current", last);
  await page.keyboard.press("Shift+j");
  await expect(objects(page)).not.toHaveAttribute("data-current", last);
  await page.keyboard.press("j");
  await expect(objects(page)).toHaveAttribute("data-current", last);
  await page.keyboard.press("j");
  await expect(form(page)).toBeVisible();
});

test("a dot in the form jumps to any object", async ({ page }) => {
  await openStage(page);
  await agreeUntilForm(page);
  await back(page)
    .getByRole("group", { name: "Objects" })
    .getByRole("button", { name: "T1" })
    .click();
  await expect(form(page)).toHaveCount(0);
  await expect(objects(page)).toHaveAttribute("data-current", "T1");
});

const review = (page: Page) => page.getByRole("tabpanel");
const done = (page: Page) => page.getByText("Slide 8 is done");

async function openScene(page: Page, moveOn: boolean) {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
  if (moveOn) return;
  await page.getByRole("tab", { name: "Display" }).click();
  await review(page)
    .getByRole("switch", { name: /Move on by itself/ })
    .click();
  await page.getByRole("tab", { name: "Review" }).click();
}

async function decideAll(page: Page, moveOn: boolean) {
  for (let step = 0; step < 80; step += 1) {
    if (await done(page).isVisible()) return;
    await page.keyboard.press("k");
    if (moveOn) continue;
    const shown = await done(page)
      .waitFor({ timeout: 300 })
      .then(() => true)
      .catch(() => false);
    if (shown) return;
    await page.keyboard.press("j");
  }
}

for (const moveOn of [true, false]) {
  test(`the guided scene opens the form at once and returns to it with move on ${moveOn ? "on" : "off"}`, async ({
    page,
  }) => {
    await openScene(page, moveOn);
    await decideAll(page, moveOn);
    await expect(done(page)).toBeVisible();
    await rating(review(page)).click();
    await expect(rating(review(page))).toBeChecked();

    const backButton = page
      .getByTestId("guided-form-back")
      .getByRole("button", { name: /^Back to / });
    const last = ((await backButton.innerText()).match(/Back to (\S+)/) ?? [])[1] ?? "";
    await backButton.click();
    await expect(done(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Back to ${last}` })).toBeVisible();

    await page.keyboard.press("u");
    await expect(done(page)).toBeVisible();
    await expect(rating(review(page))).toBeChecked();

    await page.keyboard.press("Shift+j");
    await expect(done(page)).toHaveCount(0);
  });
}
