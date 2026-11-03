import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const feedback = "components-feedback-and-surfaces--";
const patterns = "patterns-app-patterns--";
const modals = "components-modals-and-flow-pages--";

test("Go to moves focus to the field or the question it names", async ({ page }) => {
  await page.goto(story(`${feedback}before-you-go-to`));
  const list = page.locator('[data-slot="before-you-list"]');
  await expect(list.getByRole("list", { name: "Before you can send" })).toBeVisible();
  await list.getByRole("button", { name: "Go to the field" }).click();
  await expect(page.getByRole("textbox", { name: "Task name" })).toBeFocused();
  await list.getByRole("button", { name: "Go to the question" }).click();
  await expect(page.getByRole("region", { name: "Question 2" })).toBeFocused();
});

test("each Go to link is described by the blocker it fixes", async ({ page }) => {
  await page.goto(story(`${feedback}before-you-go-to`));
  await expect(
    page.getByRole("button", { name: "Go to the question" }),
  ).toHaveAccessibleDescription("Question 2 is not answered");
});

test("one blocker shows no list and the disabled submit names the reason", async ({ page }) => {
  await page.goto(story(`${patterns}slide-done-one-blocker`));
  await expect(page.locator('[data-slot="before-you-list"]')).toHaveCount(0);
  const submit = page.getByRole("button", { name: /^Submit and open slide 9/ });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription("T5 is still open.");
});

test("several blockers show the list and the disabled submit is described by it", async ({
  page,
}) => {
  await page.goto(story(`${patterns}slide-done-blockers`));
  await expect(page.locator('[data-slot="before-you-list"] li')).toHaveCount(3);
  const submit = page.getByRole("button", { name: /^Submit and open slide 9/ });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(/^Before you submit.*T5 is still open/);
});

test("the small modal names the reason on its disabled primary", async ({ page }) => {
  await page.goto(story(`${modals}one-blocker`));
  await expect(page.getByRole("button", { name: /^Send 3 objects/ })).toHaveAccessibleDescription(
    "Pick an adjudicator first.",
  );
  await page.goto(story(`${modals}blocker-list`));
  await expect(page.getByRole("button", { name: /^Sign with/ })).toHaveAccessibleDescription(
    /^Before you can sign off.*2 reviews are still missing/,
  );
});

for (const id of [
  `${feedback}before-you-go-to`,
  `${patterns}slide-done-one-blocker`,
  `${patterns}slide-done-blockers`,
]) {
  test(`${id} passes axe`, async ({ page }) => {
    await page.goto(story(id));
    await expect(page.locator("#storybook-root")).not.toBeEmpty();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .exclude("[data-base-ui-focus-guard]")
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
