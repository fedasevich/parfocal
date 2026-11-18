import { expect, type Page, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-dismissal--${name}&viewMode=story&globals=a11y.manual:!true`;

const state = (page: Page) => page.getByTestId("state");

const outsideClick = async (page: Page) => {
  await expect(
    page.locator('[role="dialog"], [data-slot="slide-submitted-scrim"]').first(),
  ).toBeVisible();
  await page.mouse.click(3, 3);
};

const kinds = [
  "dialog-kind",
  "sheet-kind",
  "small-modal-kind",
  "job-window-kind",
  "settings-kind",
  "drawer-kind",
  "slide-submitted-kind",
];

for (const kind of kinds) {
  test(`${kind} closes on an outside click`, async ({ page }) => {
    await page.goto(story(kind));
    await expect(state(page)).toHaveText("open");
    await outsideClick(page);
    await expect(state(page)).toHaveText("closed");
  });

  test(`${kind} closes on Escape`, async ({ page }) => {
    await page.goto(story(kind));
    await expect(state(page)).toHaveText("open");
    await page.keyboard.press("Escape");
    await expect(state(page)).toHaveText("closed");
  });
}

test("a click inside a dialog does not close it", async ({ page }) => {
  await page.goto(story("small-modal-kind"));
  await page.getByText("Pick a new name.").click();
  await expect(state(page)).toHaveText("open");
});

test("a modal with an unsaved form asks before an outside click closes it", async ({ page }) => {
  await page.goto(story("small-modal-with-unsaved-form"));
  await outsideClick(page);
  await expect(state(page)).toHaveText("open");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(state(page)).toHaveText("open");
});

test("a modal with an unsaved form asks before Escape closes it, and Discard closes it", async ({
  page,
}) => {
  await page.goto(story("small-modal-with-unsaved-form"));
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(state(page)).toHaveText("open");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(state(page)).toHaveText("closed");
});
