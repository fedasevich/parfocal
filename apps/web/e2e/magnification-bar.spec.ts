import { magnificationBarRect } from "@parfocal/ui/lib/magnification-bar";
import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  const bar = page.getByTestId("magnification-bar");
  await expect(bar).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(bar).not.toHaveAttribute("data-open", /.*/, { timeout: 6000 });
  return bar;
}

const parts = (page: Page, part: string) =>
  page.getByTestId("magnification-bar").locator(`[data-part="${part}"]`);

test("the bar rests folded as a chip with the magnification and the scale bar", async ({
  page,
}) => {
  const bar = await openSlide(page);
  await expect(bar).toHaveAttribute("aria-label", /^Magnification \d/);
  await expect(parts(page, "presets")).toHaveCSS("opacity", "0");
  await expect(parts(page, "readout")).toHaveCSS("opacity", "0");
  await expect(parts(page, "brightness")).toHaveCSS("opacity", "0");
});

test("hovering opens the presets and leaving folds the bar back", async ({ page }) => {
  const bar = await openSlide(page);
  await bar.hover();
  await expect(bar).toHaveAttribute("data-open", "true");
  await expect(parts(page, "presets")).toHaveCSS("opacity", "1");
  await expect(bar.getByRole("button", { name: "40×" })).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(bar).not.toHaveAttribute("data-open", /.*/, { timeout: 6000 });
});

test("keyboard focus opens the bar and leaving it folds it back", async ({ page }) => {
  const bar = await openSlide(page);
  await bar.focus();
  await expect(bar).toHaveAttribute("data-open", "true");
  await bar.blur();
  await expect(bar).not.toHaveAttribute("data-open", /.*/, { timeout: 6000 });
});

test("a preset button jumps to that magnification and highlights it", async ({ page }) => {
  const bar = await openSlide(page);
  await bar.hover();
  await bar.getByRole("button", { name: "20×", exact: true }).click();
  await expect(bar).toHaveAttribute("aria-label", /^Magnification 20×/);
  await expect(bar.getByRole("button", { name: "20×", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar.getByRole("button", { name: "10×", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("Alt plus a number jumps, keeps the bar open while held and for 2 s after the zoom", async ({
  page,
}) => {
  const bar = await openSlide(page);
  await page.keyboard.down("Alt");
  await page.keyboard.down("Digit5");
  await expect(bar).toHaveAttribute("data-open", "true");
  await expect(bar).toHaveAttribute("aria-label", /^Magnification 20×/);
  await page.keyboard.up("Digit5");
  await page.keyboard.up("Alt");
  await expect(bar).toHaveAttribute("data-open", "true");
  await expect(bar).not.toHaveAttribute("data-open", /.*/, { timeout: 6000 });
  await page.keyboard.press("Alt+6");
  await expect(bar).toHaveAttribute("aria-label", /^Magnification 40×/);
});

test("brightness shows in the folded chip only when it is not 100 percent and holds the bar open while its popover is open", async ({
  page,
}) => {
  const bar = await openSlide(page);
  await bar.hover();
  await bar.getByRole("button", { name: /^Slide brightness 100%/ }).click();
  const popover = page.getByRole("dialog", { name: "Slide brightness" });
  await expect(popover).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(bar).toHaveAttribute("data-open", "true");
  await popover.getByRole("button", { name: "Dimmer" }).click();
  await expect(bar.getByRole("button", { name: /^Slide brightness 90%/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(bar).not.toHaveAttribute("data-open", /.*/, { timeout: 6000 });
  await expect(parts(page, "brightness")).toHaveCSS("opacity", "1");
  await expect(parts(page, "presets")).toHaveCSS("opacity", "0");
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(parts(page, "brightness")).toHaveCSS("opacity", "1");
});

test("the blocked area covers the bar in both states", async ({ page }) => {
  const bar = await openSlide(page);
  const stage = page.getByTestId("slide-stage");
  const canvas = async () => {
    const box = await stage.boundingBox();
    if (!box) throw new Error("no stage");
    return { box, size: { width: box.width, height: box.height } };
  };
  const covered = async (open: boolean) => {
    const { box, size } = await canvas();
    const bounds = await bar.boundingBox();
    if (!bounds) throw new Error("no bar");
    const [x, y, width, height] = magnificationBarRect(size, { open, brightnessChanged: false });
    expect(bounds.x - box.x).toBeGreaterThanOrEqual(x - 1);
    expect(bounds.x - box.x + bounds.width).toBeLessThanOrEqual(x + width + 1);
    expect(bounds.y - box.y).toBeGreaterThanOrEqual(y - 1);
    expect(bounds.y - box.y + bounds.height).toBeLessThanOrEqual(y + height + 1);
  };
  await covered(false);
  await bar.hover();
  await expect(parts(page, "presets")).toHaveCSS("opacity", "1");
  await page.waitForTimeout(500);
  await covered(true);
});

test("under reduced motion the bar opens without any transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bar = await openSlide(page);
  await expect(parts(page, "presets")).toHaveCSS("transition-duration", "0s");
  await bar.hover();
  await expect(parts(page, "presets")).toHaveCSS("opacity", "1");
});
