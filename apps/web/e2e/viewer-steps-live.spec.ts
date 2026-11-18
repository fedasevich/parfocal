import { expect, type Page, test } from "./a11y.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

const taskSlide = `/projects/${p07}/slides/${tumor044}/live?task=${rt14}&workspace=review&as=DH`;

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

const magnification = async (page: Page) => {
  const label = (await page.getByTestId("magnification-bar").getAttribute("aria-label")) ?? "";
  return Number(/(\d+(?:\.\d+)?)/.exec(label)?.[1] ?? Number.NaN);
};

test("E and Q step to the next and previous slide of the task", async ({ page }) => {
  await page.goto(taskSlide);
  await ready(page);
  const progress = page.getByTestId("slide-progress");
  await expect(progress).toContainText(/Slide \d+ of \d+/);
  const before = (await progress.textContent()) ?? "";
  const here = page.url();
  await page.keyboard.press("e");
  await expect.poll(() => page.url()).not.toBe(here);
  await expect(progress).not.toContainText(before.slice(0, 12));
  const next = page.url();
  await ready(page);
  await page.keyboard.press("q");
  await expect.poll(() => page.url()).not.toBe(next);
});

test("the progress popover shows the task, the slide and the way to the neighbours", async ({
  page,
}) => {
  await page.goto(taskSlide);
  await ready(page);
  await page.getByTestId("progress-trigger").click();
  const popover = page.getByRole("dialog", { name: "Review progress" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Task RT-14");
  await expect(popover).toContainText("Round 2");
  await expect(popover.getByRole("button", { name: "Whole slide" })).toBeVisible();
  const spill = await popover.evaluate((dialog) => {
    const box = dialog.parentElement?.getBoundingClientRect();
    const content = dialog.getBoundingClientRect();
    return box ? content.right - box.right : Number.POSITIVE_INFINITY;
  });
  expect(spill).toBeLessThanOrEqual(0);
});

test("Open report takes the place of Submit in a clinical project", async ({ page }) => {
  await page.goto(`/projects/${p03}?tab=slides`);
  await page.getByTestId("slide-row").first().click();
  await ready(page);
  const bar = page.getByTestId("live-top-bar");
  await expect(bar.getByRole("button", { name: "Submit" })).toHaveCount(0);
  await bar.getByRole("button", { name: "Open report" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/cases\/[0-9a-f-]+\/report/);
  await expect(page.getByTestId("clinical-report")).toBeVisible();
});

test("Go to on a comment thread moves the camera to its area", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=review&as=DH`);
  await ready(page);
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Comments" }).click();
  const before = await magnification(page);
  await page.getByRole("button", { name: "Go to T2" }).click();
  await expect.poll(() => magnification(page), { timeout: 15_000 }).toBeGreaterThan(before);
  expect(await magnification(page)).toBeGreaterThan(10);
});
