import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const stories = "components-modals-and-flow-pages--";
const modal = '[data-slot="small-modal"]';

const widthOf = (page: Page) =>
  page.locator(modal).evaluate((node) => (node as HTMLElement).offsetWidth);

const focusIsInside = (page: Page) =>
  page.evaluate(
    (selector) => document.querySelector(selector)?.contains(document.activeElement) ?? false,
    modal,
  );

test("the 480 modals keep their width whatever the content", async ({ page }) => {
  for (const name of ["nudge-480", "long-content", "busy", "one-blocker"]) {
    await page.goto(story(stories + name));
    await expect(page.locator(modal)).toBeVisible();
    expect(await widthOf(page)).toBe(480);
  }
});

test("the 560 modals keep their width whatever the content", async ({ page }) => {
  for (const name of ["reassign-560", "blocker-list", "done-only-560"]) {
    await page.goto(story(stories + name));
    await expect(page.locator(modal)).toBeVisible();
    expect(await widthOf(page)).toBe(560);
  }
});

test("a long title and body grow the modal in height, never in width", async ({ page }) => {
  await page.goto(story(`${stories}long-content`));
  const box = await page.locator(modal).evaluate((node) => ({
    width: (node as HTMLElement).offsetWidth,
    height: (node as HTMLElement).offsetHeight,
  }));
  expect(box?.width).toBe(480);
  expect(box?.height).toBeGreaterThan(300);
});

test("the scrim is 62% black in dark", async ({ page }) => {
  await page.goto(`${story(`${stories}nudge-480`)}&globals=theme:dark`);
  await expect(page.locator(modal)).toBeVisible();
  const color = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector('[class*="bg-scrim"]') as Element).backgroundColor,
  );
  expect(color).toBe("rgba(0, 0, 0, 0.62)");
});

test("focus starts on the first field and stays inside the modal", async ({ page }) => {
  await page.goto(story(`${stories}nudge-480`));
  await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press(key);
      await expect.poll(() => focusIsInside(page)).toBe(true);
    }
  }
});

test("Esc and the cross close without saving", async ({ page }) => {
  await page.goto(story(`${stories}type-to-enable-480`));
  await page.getByRole("textbox", { name: "Name" }).fill("Study B");
  await page.keyboard.press("Escape");
  await expect(page.locator(modal)).toBeHidden();
  await expect(page.getByLabel("Saved name")).toHaveText("");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(modal)).toBeHidden();
  await expect(page.getByLabel("Saved name")).toHaveText("");
});

test("Enter runs the primary only when it is on", async ({ page }) => {
  await page.goto(story(`${stories}type-to-enable-480`));
  const field = page.getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(modal)).toBeVisible();
  await field.fill("Study B");
  await page.keyboard.press("Enter");
  await expect(page.locator(modal)).toBeHidden();
  await expect(page.getByLabel("Saved name")).toHaveText("Study B");
});

test("Enter in a multi-line field adds a line and does not run the primary", async ({ page }) => {
  await page.goto(story(`${stories}nudge-480`));
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(page.locator(modal)).toBeVisible();
});

test("one blocker turns the primary off and says why, two show the list", async ({ page }) => {
  await page.goto(story(`${stories}one-blocker`));
  await expect(page.getByRole("button", { name: /^Send 3 objects/ })).toBeDisabled();
  await expect(page.locator(modal)).toContainText("Pick an adjudicator first.");
  await expect(page.locator('[data-slot="before-you-list"]')).toHaveCount(0);
  await page.goto(story(`${stories}blocker-list`));
  await expect(page.locator('[data-slot="before-you-list"] li')).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Sign with/ })).toBeDisabled();
});

for (const theme of ["dark", "light"]) {
  test(`the open modal passes axe in ${theme}`, async ({ page }) => {
    await page.goto(`${story(`${stories}reassign-560`)}&globals=theme:${theme}`);
    await expect(page.locator(modal)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .exclude("[data-base-ui-focus-guard]")
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
