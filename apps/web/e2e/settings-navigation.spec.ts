import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
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

test("the navigation section lists the camera feel rows and a live preview", async ({ page }) => {
  await page.goto("/settings/navigation");
  const settings = dialog(page);
  for (const label of [
    "Camera feel",
    "Coasting",
    "Animated jumps",
    "Zoom anchor",
    "Objective detents",
    "Invert zoom direction",
  ]) {
    await expect(settings.getByText(label, { exact: true }).first()).toBeVisible();
  }
  const preview = settings.getByTestId("feel-preview");
  await expect(preview).toHaveAttribute("data-anchor", "cursor");
  await settings.getByRole("radio", { name: "Instant" }).click();
  await expect(preview).toHaveAttribute("data-zoom-ms", "0");
  await expect(preview).toHaveAttribute("data-coast-ms", "0");
  await settings.getByRole("radio", { name: "Smooth" }).click();
  await expect(preview).not.toHaveAttribute("data-zoom-ms", "0");
  await settings.getByRole("radio", { name: "View centre" }).click();
  await expect(preview).toHaveAttribute("data-anchor", "centre");
});

test("the camera feel and its overrides stay after a reload", async ({ page }) => {
  await page.goto("/settings/navigation");
  const settings = dialog(page);
  await settings.getByRole("radio", { name: "Precise" }).click();
  await settings.getByRole("switch", { name: "Animated jumps" }).click();
  await settings.getByRole("switch", { name: "Objective detents" }).click();
  await page.reload();
  const again = dialog(page);
  await expect(again.getByRole("radio", { name: "Precise" })).toBeChecked();
  await expect(again.getByRole("switch", { name: "Animated jumps" })).not.toBeChecked();
  await expect(again.getByRole("switch", { name: "Objective detents" })).toBeChecked();
  await expect(again.getByTestId("feel-preview")).toHaveAttribute("data-coast-ms", "0");
});

test("inverting the zoom direction in Settings flips the wheel on the slide", async ({ page }) => {
  test.setTimeout(60_000);
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await settledZoom(page);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => zoomOf(page)).not.toBe(before);
  expect(await settledZoom(page)).toBeGreaterThan(before);

  await page.goto("/settings/navigation");
  await dialog(page).getByRole("switch", { name: "Invert zoom direction" }).click();

  const inverted = await openSlide(page);
  const invertedBox = (await inverted.boundingBox()) ?? box;
  await page.mouse.move(
    invertedBox.x + invertedBox.width / 2,
    invertedBox.y + invertedBox.height / 2,
  );
  const start = await settledZoom(page);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => zoomOf(page)).not.toBe(start);
  expect(await settledZoom(page)).toBeGreaterThan(start);
});
