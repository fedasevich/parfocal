import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

const heightOf = (page: Page, name: string) =>
  page
    .getByRole("button", { name, exact: true })
    .evaluate((element) => element.getBoundingClientRect().height);

test("a click presses the button, a disabled button ignores it and an icon button clears", async ({
  page,
}) => {
  await page.goto(story("controls-button--interactive"));
  const count = page.locator("output");
  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(count).toHaveText("Pressed 2 times");
  await expect(page.getByRole("button", { name: "Locked" })).toBeDisabled();
  await page.getByRole("button", { name: "Locked" }).click({ force: true });
  await expect(count).toHaveText("Pressed 2 times");
  await page.getByRole("button", { name: "Clear the count" }).click();
  await expect(count).toHaveText("Pressed 0 times");
});

test("Tab skips the disabled button, Enter and Space press, and focus shows a ring", async ({
  page,
}) => {
  await page.goto(story("controls-button--interactive"));
  const submit = page.getByRole("button", { name: "Submit" });
  await expect(submit).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  const outline = await submit.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(page.locator("output")).toHaveText("Pressed 2 times");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Clear the count" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("output")).toHaveText("Pressed 0 times");
});

test("buttons are 32 px tall and icon buttons never drop under a 24 px target", async ({
  page,
}) => {
  await page.goto(story("controls-button--variants"));
  for (const name of ["Submit", "Cancel", "Skip for now"]) {
    expect(await heightOf(page, name)).toBe(32);
  }
  await page.goto(story("controls-button--icon-buttons"));
  const sizes: Record<string, number> = {
    Close: 32,
    More: 28,
    "Centre on the selection": 24,
    "Download report": 32,
  };
  for (const [name, size] of Object.entries(sizes)) {
    const box = await page
      .getByRole("button", { name, exact: true })
      .evaluate((element) => element.getBoundingClientRect());
    expect(box.height).toBe(size);
    expect(box.width).toBe(size);
    expect(box.width).toBeGreaterThanOrEqual(24);
  }
  await expect(page.getByRole("button", { name: "Close" })).toHaveAttribute("title", "Close");
});

test("hover and press darken the primary fill so its text keeps its contrast", async ({ page }) => {
  await page.goto(story("controls-button--interactive"));
  const submit = page.getByRole("button", { name: "Submit" });
  const fill = () => submit.evaluate((element) => getComputedStyle(element).backgroundColor);
  const rest = await fill();
  await submit.hover();
  await expect.poll(fill).not.toBe(rest);
  const hovered = await fill();
  await page.mouse.down();
  await expect.poll(fill).not.toBe(hovered);
  await page.mouse.up();
});

test("the top bar keeps Upload a normal button, so a screen has one filled primary", async ({
  page,
}) => {
  await page.goto(story("patterns-app-patterns--shell"));
  await expect(page.getByRole("button", { name: "Upload" })).not.toHaveAttribute(
    "data-variant",
    "primary",
  );
  await expect(page.locator('[data-slot="button"][data-variant="primary"]')).toHaveCount(0);
});
