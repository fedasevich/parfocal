import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

const runningAnimations = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running" && animation.currentTime !== null)
        .length,
  );

const longestTiming = (page: Page) =>
  page.evaluate(() => {
    const seconds = (value: string) =>
      Math.max(...value.split(",").map((part) => Number.parseFloat(part) || 0));
    let longest = 0;
    for (const node of document.querySelectorAll("*")) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(node, pseudo);
        longest = Math.max(
          longest,
          seconds(style.transitionDuration),
          seconds(style.transitionDelay),
          seconds(style.animationDuration),
          seconds(style.animationDelay),
        );
      }
    }
    return longest;
  });

test("motion tokens drive the move, presenting runs at one third speed", async ({ page }) => {
  await page.goto(story("components-motion--normal"));
  await expect(page.getByTestId("mover")).toHaveCSS("transition-duration", "0.3s");
  await expect(page.getByRole("button", { name: "Move" })).toHaveCSS(
    "transition-duration",
    "0.12s",
  );
  await page.getByRole("button", { name: "Move" }).click();
  expect(await runningAnimations(page)).toBeGreaterThan(0);

  await page.goto(story("components-motion--presenting"));
  await expect(page.getByTestId("mover")).toHaveCSS("transition-duration", "0.9s");
  await expect(page.getByRole("button", { name: "Move" })).toHaveCSS(
    "transition-duration",
    "0.36s",
  );
});

for (const id of ["components-motion--normal", "components-motion--presenting"]) {
  test(`under prefers-reduced-motion ${id} has no animation at all`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story(id));
    await expect(page.getByTestId("mover")).toBeVisible();
    expect(await longestTiming(page)).toBe(0);
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByTestId("entering")).toHaveCSS("opacity", "1");
    expect(await runningAnimations(page)).toBe(0);
    expect(await longestTiming(page)).toBe(0);
  });
}

test("the reduced motion mode is a cut without the media query", async ({ page }) => {
  await page.goto(story("components-motion--reduced"));
  await page.getByRole("button", { name: "Move" }).click();
  expect(await runningAnimations(page)).toBe(0);
  await expect(page.getByTestId("mover")).toHaveCSS("transition-duration", "0s");
  await expect(page.getByTestId("entering")).toHaveCSS("animation-duration", "0s");
});

test("under prefers-reduced-motion an open dialog has no animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(story("controls-dialog--open"));
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await runningAnimations(page)).toBe(0);
  expect(await longestTiming(page)).toBe(0);
});

test("an open dialog runs on the motion tokens and slows down in presenting mode", async ({
  page,
}) => {
  await page.goto(story("controls-dialog--open"));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("animation-duration", "0.12s");
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "presenting";
  });
  await expect(dialog).toHaveCSS("animation-duration", "0.36s");
});
