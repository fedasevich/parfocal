import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const flows = "components-modals-and-flow-pages--";

const stepper = (page: Page) => page.getByRole("list", { name: "Steps" });
const currentStep = (page: Page) => stepper(page).locator('[aria-current="step"]');

test("a visited step opens from the stepper", async ({ page }) => {
  await page.goto(story(`${flows}flow-middle-step`));
  await expect(currentStep(page)).toHaveText(/What to check/);
  await stepper(page)
    .getByRole("button", { name: /Slides/ })
    .click();
  await expect(currentStep(page)).toHaveText(/Slides/);
  await stepper(page)
    .getByRole("button", { name: /What to check/ })
    .click();
  await expect(currentStep(page)).toHaveText(/What to check/);
});

test("a visited step after the current one stays open to click", async ({ page }) => {
  await page.goto(story(`${flows}flow-middle-step-revisited`));
  await expect(currentStep(page)).toHaveText(/Reviewers/);
  await stepper(page)
    .getByRole("button", { name: /How it runs/ })
    .click();
  await expect(currentStep(page)).toHaveText(/How it runs/);
});

test("an unreached step is refused and says why", async ({ page }) => {
  await page.goto(story(`${flows}flow-middle-step`));
  const send = stepper(page).getByRole("button", { name: /Send/ });
  await expect(send).toHaveAttribute("aria-disabled", "true");
  await expect(send).toHaveAccessibleDescription(
    "Not reached yet. Finish What to check first, then use Next.",
  );
  await send.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(/Not reached yet/);
  await send.click({ force: true });
  await expect(currentStep(page)).toHaveText(/What to check/);
});

test("arrow keys move through the stepper and Enter opens a step", async ({ page }) => {
  await page.goto(story(`${flows}flow-middle-step-revisited`));
  const steps = stepper(page);
  await steps.getByRole("button", { name: /Slides/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(steps.getByRole("button", { name: /What to check/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(steps.getByRole("button", { name: /Send/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(steps.getByRole("button", { name: /Slides/ })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(steps.getByRole("button", { name: /How it runs/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(currentStep(page)).toHaveText(/How it runs/);
});

test("Tab reaches the steps in order and Next moves forward", async ({ page }) => {
  await page.goto(story(`${flows}flow-first-step`));
  const next = page.getByRole("button", { name: /^Next/ });
  await next.click();
  await expect(currentStep(page)).toHaveText(/Reviewers/);
  await stepper(page)
    .getByRole("button", { name: /Slides/ })
    .focus();
  await page.keyboard.press("Tab");
  await expect(stepper(page).getByRole("button", { name: /What to check/ })).toBeFocused();
});

test("Enter runs the primary action and a blocked one stays put", async ({ page }) => {
  await page.goto(story(`${flows}flow-first-step`));
  await expect(currentStep(page)).toHaveText(/Slides/);
  await page.keyboard.press("Enter");
  await expect(currentStep(page)).toHaveText(/Reviewers/);
  await page.goto(story(`${flows}flow-next-blocked`));
  await expect(currentStep(page)).toHaveText(/Reviewers/);
  await page.keyboard.press("Enter");
  await expect(currentStep(page)).toHaveText(/Reviewers/);
});

test("a disabled Next names its reason", async ({ page }) => {
  await page.goto(story(`${flows}flow-next-blocked`));
  const next = page.getByRole("button", { name: /^Next/ });
  await expect(next).toBeDisabled();
  await expect(next).toHaveAccessibleDescription("Pick at least one reviewer first.");
});

test("the last step sums up with a Change link that opens its step", async ({ page }) => {
  await page.goto(story(`${flows}flow-last-step`));
  await expect(page.getByRole("button", { name: /^Send to 3 reviewers/ })).toBeVisible();
  await page.getByRole("button", { name: "Change Reviewers" }).click();
  await expect(currentStep(page)).toHaveText(/Reviewers/);
});

test("the bar casts a shadow only while more content follows", async ({ page }) => {
  await page.goto(story(`${flows}flow-long-step`));
  const dock = page.locator('[data-slot="flow-bar-dock"]');
  await expect(dock).toHaveAttribute("data-more-below", "true");
  await page
    .locator('[data-slot="flow-body"]')
    .evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expect(dock).not.toHaveAttribute("data-more-below");
  await page.goto(story(`${flows}flow-first-step`));
  await expect(page.locator('[data-slot="flow-bar-dock"]')).not.toHaveAttribute("data-more-below");
});

for (const name of [
  "flow-first-step",
  "flow-middle-step",
  "flow-middle-step-revisited",
  "flow-next-blocked",
  "flow-long-step",
  "flow-last-step",
]) {
  test(`${name} passes axe`, async ({ page }) => {
    await page.goto(story(flows + name));
    await expect(page.locator('[data-slot="flow-page"]')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-slot="flow-page"]').analyze();
    expect(results.violations).toEqual([]);
  });
}
