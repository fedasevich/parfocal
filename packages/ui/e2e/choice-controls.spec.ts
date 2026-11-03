import { expect, type Locator, type Page, test } from "@playwright/test";

const story = (id: string) =>
  `/iframe.html?id=controls-choice-controls--${id}&viewMode=story&globals=a11y.manual:!true`;

const ring = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });

const tabInto = async (page: Page) => {
  await page.locator("#storybook-root > *").first().waitFor();
  await page.keyboard.press("Tab");
};

test("the segmented control moves with the arrow keys and shows a focus ring", async ({ page }) => {
  await page.goto(story("segmented"));
  await tabInto(page);
  const outline = page.getByRole("radio", { name: "Outline" });
  const fill = page.getByRole("radio", { name: "Fill" });
  await expect(outline).toBeFocused();
  expect(await ring(outline)).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("ArrowRight");
  await expect(fill).toBeFocused();
  await expect(fill).toHaveAttribute("aria-checked", "true");
  await expect(outline).toHaveAttribute("aria-checked", "false");
  const chosen = await fill.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(chosen).toContain("inset");
});

test("the toggle flips with Space and shows a focus ring", async ({ page }) => {
  await page.goto(story("toggle-row"));
  await tabInto(page);
  const toggle = page.getByRole("switch", { name: "Show cell outlines" });
  await expect(toggle).toBeFocused();
  await expect(toggle).toBeChecked();
  expect(await ring(toggle)).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
});

test("the slider steps with the arrow keys and jumps with Home and End", async ({ page }) => {
  await page.goto(story("slider-with-value"));
  await tabInto(page);
  const slider = page.getByRole("slider", { name: "Opacity" });
  const value = page.locator("output");
  await expect(slider).toBeFocused();
  const thumb = page.locator('[data-slot="slider-thumb"]');
  expect(await ring(thumb)).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveText("61%");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(value).toHaveText("59%");
  await page.keyboard.press("End");
  await expect(value).toHaveText("100%");
  await page.keyboard.press("Home");
  await expect(value).toHaveText("0%");
});

test("the number stepper counts with the arrow keys and stops at its bounds", async ({ page }) => {
  await page.goto(story("stepper"));
  const input = page.getByRole("textbox", { name: "the first answer that agrees" });
  await input.focus();
  expect(await ring(input)).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("5");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("5");
  await expect(
    page.getByRole("button", { name: "Raise the first answer that agrees" }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveValue("3");
  await expect(
    page.getByRole("button", { name: "Lower the first answer that agrees" }),
  ).toBeDisabled();
});

test("radio rows move with the arrow keys and skip a disabled row", async ({ page }) => {
  await page.goto(story("radio-rows"));
  await tabInto(page);
  const all = page.getByRole("radio", { name: /Everyone reviews every slide/ });
  const even = page.getByRole("radio", { name: /Split evenly/ });
  const per = page.getByRole("radio", { name: /Per slide/ });
  await expect(all).toBeFocused();
  expect(await ring(all)).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("ArrowDown");
  await expect(even).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(per).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(all).toBeChecked();
  await expect(page.getByRole("radio", { name: /Decide later/ })).toBeDisabled();
});

test("a locked control reads as dim text with a lock and its reason, and takes no focus", async ({
  page,
}) => {
  await page.goto(story("locked"));
  const rows = page.locator('[data-slot="control-row"][data-locked]');
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole("img", { name: "Locked" })).toHaveCount(4);
  await expect(page.getByText("Locked by RT-14: confidence hidden this round")).toHaveCount(4);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(page.locator("#storybook-root :focus")).toHaveCount(0);
});
