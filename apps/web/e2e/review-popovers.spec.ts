import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

async function fullViewerUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return (await link.getAttribute("href")) ?? "";
}

test("the progress ring in the guided top bar opens the review progress popover", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await page.getByRole("button", { name: /% done/ }).click();
  const popover = page.getByRole("dialog", { name: "Review progress" });
  await expect(popover).toContainText("This slide");
  await expect(popover).toContainText("Whole task");
  await expect(popover).toContainText("Saved as you go");
  await expect(popover.getByRole("button", { name: /Next slide/ })).toHaveCount(0);
  await popover.getByRole("button", { name: "Whole slide" }).click();
  await expect(page.getByText("50 sampled cells").first()).toBeVisible();
});

test("the full viewer ring shows Next slide and the slide chip lists the case", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const firstSlide = await fullViewerUrl(page);
  await page.goto(firstSlide);
  await page.getByRole("button", { name: /% done/ }).click();
  const progress = page.getByRole("dialog", { name: "Review progress" });
  await progress.getByRole("button", { name: /Next slide/ }).click();
  await expect(page).not.toHaveURL(new RegExp(`slides/${a1}`));
  await page.goto(firstSlide);
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const slides = page.getByRole("dialog", { name: "Slides in this case and task" });
  await expect(slides).toContainText("Slides in this case");
  await expect(slides.getByRole("button", { name: "Open the case" })).toBeVisible();
  await expect(slides.getByRole("button", { name: /Add slides/ })).toBeVisible();
  await slides.getByRole("button", { name: "Open the case" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
});

test("the More menu in the annotate top bar opens settings from an item", async ({ page }) => {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Annotate workspace · Auto region", exact: true })
    .click();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: /Ask for a second opinion/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await expect(page).toHaveURL(/\/settings\/shortcuts/);
});

test("the adjudicator's slide chip lists the slides queued for them", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/disagreements?scene=adjudicate`);
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const queued = page.getByRole("dialog", { name: "Slides with objects queued for you" });
  await expect(queued).toContainText("Slides with objects for you");
  await queued.getByRole("button", { name: /^A1/ }).click();
  await expect(queued).toHaveCount(0);
});

async function openSlidesPopover(page: Page) {
  await page.getByRole("button", { name: /^A1/ }).first().click();
  return page.getByRole("dialog", { name: "Slides in this case and task" });
}

test("the slides popover shows block, status and the compare buttons, and picking a row switches slides", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  const slides = await openSlidesPopover(page);
  const rows = slides.locator("[data-slot=slide-row]");
  await expect(rows.first()).toHaveAttribute("data-current", "true");
  await expect(slides.getByRole("button", { name: /Side by side with/ }).first()).toBeVisible();
  await expect(slides.getByRole("button", { name: "Compare slides" })).toBeVisible();
  await expect(slides.getByRole("button", { name: /Add slides/ })).toBeVisible();
  await rows.nth(1).click();
  await expect(page).not.toHaveURL(new RegExp(`slides/${a1}`));
});

const slideOf = (url: string) => /slides\/([^/?]+)/.exec(url)?.[1] ?? "";

test("Q and E step through the slides of the case", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await page.keyboard.press("e");
  await expect.poll(() => slideOf(page.url())).not.toBe(a1);
  await expect(page.getByRole("button", { name: /^A2/ }).first()).toBeVisible();
  await page.keyboard.press("q");
  await expect.poll(() => slideOf(page.url())).toBe(a1);
});

test("switching slides keeps the camera each slide had", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await page.getByRole("img", { name: "The whole slide" }).hover();
  await page.mouse.wheel(0, -300);
  await expect.poll(() => new URL(page.url()).searchParams.get("z")).not.toBeNull();
  const before = new URL(page.url()).searchParams;
  const zoomed = { x: before.get("x"), y: before.get("y"), z: before.get("z") };
  await page.keyboard.press("e");
  await expect.poll(() => slideOf(page.url())).not.toBe(a1);
  expect(new URL(page.url()).searchParams.get("z")).toBeNull();
  await expect(page.getByRole("button", { name: /^A2/ }).first()).toBeVisible();
  await page.keyboard.press("q");
  await expect.poll(() => slideOf(page.url())).toBe(a1);
  const after = new URL(page.url()).searchParams;
  expect({ x: after.get("x"), y: after.get("y"), z: after.get("z") }).toEqual(zoomed);
});

test("a slide reopened after a reload starts at its remembered view", async ({ page }) => {
  test.setTimeout(90_000);
  const url = await fullViewerUrl(page);
  await page.goto(url);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await page.getByRole("img", { name: "The whole slide" }).hover();
  await page.mouse.wheel(0, -300);
  await expect.poll(() => new URL(page.url()).searchParams.get("z")).not.toBeNull();
  await page.waitForTimeout(600);
  const before = new URL(page.url()).searchParams;
  const zoomed = { x: before.get("x"), y: before.get("y"), z: before.get("z") };
  const bare = new URL(page.url());
  for (const key of ["x", "y", "z"]) bare.searchParams.delete(key);
  await page.goto(bare.toString());
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect
    .poll(() => {
      const after = new URL(page.url()).searchParams;
      return { x: after.get("x"), y: after.get("y"), z: after.get("z") };
    })
    .toEqual(zoomed);
});

test("the pinned slide strip is off until the setting turns it on", async ({ page }) => {
  test.setTimeout(90_000);
  const url = await fullViewerUrl(page);
  await page.goto(url);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Slides of this case" })).toHaveCount(0);
  await page.goto("/settings/layout");
  await page.getByRole("switch", { name: "Pinned slide strip" }).click();
  await page.goto(url);
  const strip = page.getByRole("navigation", { name: "Slides of this case" });
  await expect(strip).toBeVisible();
  await strip.getByRole("button").nth(1).click();
  await expect.poll(() => slideOf(page.url())).not.toBe(a1);
  await page.goto("/settings/layout");
  await page.getByRole("switch", { name: "Pinned slide strip" }).click();
  await page.goto(url);
  await expect(page.getByRole("navigation", { name: "Slides of this case" })).toHaveCount(0);
});

test("Side by side opens the chosen slide on the right and Compare slides opens its picker", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  let slides = await openSlidesPopover(page);
  const button = slides.getByRole("button", { name: /Side by side with/ }).first();
  const label = (await button.getAttribute("aria-label")) ?? "";
  const target = label.replace("Side by side with ", "").split(" ")[0] ?? "";
  await button.click();
  await expect(page).toHaveURL(/scene=picked/);
  await expect(page.getByRole("region", { name: /^Left: A1/ })).toBeVisible();
  await expect(page.getByRole("region", { name: new RegExp(`^Right: ${target}`) })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Slide for the right side" })).toHaveCount(0);

  await page.goto(await fullViewerUrl(page));
  slides = await openSlidesPopover(page);
  await slides.getByRole("button", { name: "Compare slides" }).click();
  await expect(page).toHaveURL(/scene=picking/);
  await expect(page.getByRole("listbox", { name: "Slide for the right side" })).toBeVisible();
});
