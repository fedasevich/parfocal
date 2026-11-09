import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  return stage;
}

const zoomOf = async (page: Page) => {
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");
  return Number(camera?.split(",")[2]);
};

async function settledZoom(page: Page) {
  let last = await zoomOf(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(150);
      const now = await zoomOf(page);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return last;
}

async function zoomStepAfterWheel(page: Page) {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await settledZoom(page);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => zoomOf(page)).not.toBe(before);
  const after = await settledZoom(page);
  return after - before;
}

test("a lower wheel speed saved in Settings makes the slide wheel zoom step smaller", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const defaultStep = await zoomStepAfterWheel(page);
  expect(defaultStep).toBeGreaterThan(0);

  await page.goto("/settings/navigation");
  const dialog = page.getByRole("dialog");
  for (let press = 0; press < 3; press += 1) {
    await dialog.getByRole("button", { name: "Lower Pan and zoom speed" }).click();
  }

  const slowerStep = await zoomStepAfterWheel(page);
  expect(slowerStep).toBeGreaterThan(0);
  expect(slowerStep).toBeLessThan(defaultStep * 0.75);
});
