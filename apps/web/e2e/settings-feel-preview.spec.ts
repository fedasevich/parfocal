import { expect, type Page, test } from "./a11y.ts";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

test("the Try it preview follows speed, dead zone, invert and camera feel", async ({ page }) => {
  await page.goto("/settings/navigation");
  const settings = dialog(page);
  const preview = settings.getByTestId("feel-preview");
  const stick = settings.getByTestId("feel-stick");
  await expect(preview).toHaveAttribute("data-speed-factor", "1.000");

  const octaves = async () => Number(await preview.getAttribute("data-wheel-octaves"));
  const reach = async () => Math.abs(await octaves());
  const before = await reach();
  for (let step = 0; step < 3; step += 1) {
    await settings.getByRole("button", { name: "Raise Pan and zoom speed" }).click();
  }
  await expect(preview).toHaveAttribute("data-speed-factor", "1.500");
  expect(await reach()).toBeGreaterThan(before);

  const deadZone = settings.getByRole("slider", { name: "Dead zone" });
  await expect(deadZone).toHaveAttribute("min", "0");
  await expect(deadZone).toHaveAttribute("max", "50");
  await expect(stick).toHaveAttribute("data-dead-zone", "10");
  expect(Number(await preview.getAttribute("data-half-push"))).toBeGreaterThan(0);
  for (let step = 0; step < 8; step += 1) {
    await settings.getByRole("button", { name: "Raise Dead zone" }).click();
  }
  await expect(stick).toHaveAttribute("data-dead-zone", "50");
  await expect(preview).toHaveAttribute("data-half-push", "0");

  const normal = await octaves();
  await settings.getByRole("switch", { name: "Invert zoom direction" }).click();
  await expect.poll(octaves).toBe(-normal);

  await settings.getByRole("radio", { name: "Instant" }).click();
  await expect(preview).toHaveAttribute("data-zoom-ms", "0");
  await expect(preview).toHaveAttribute("data-coast-ms", "0");
});

test("scrolling the Try it grid zooms it and Invert flips the direction", async ({ page }) => {
  await page.goto("/settings/navigation");
  const settings = dialog(page);
  const preview = settings.getByTestId("feel-preview");
  const magnification = async () => Number(await preview.getAttribute("data-magnification"));
  await expect(preview).toHaveAttribute("data-magnification", "5.0");
  await preview.scrollIntoViewIfNeeded();
  const box = (await preview.boundingBox()) ?? { x: 0, y: 0, width: 280, height: 120 };
  await page.mouse.move(box.x + 140, box.y + 60);
  await page.mouse.wheel(0, -100);
  await expect.poll(magnification).toBeGreaterThan(5);
  const zoomed = await magnification();
  await settings.getByRole("switch", { name: "Invert zoom direction" }).click();
  await preview.scrollIntoViewIfNeeded();
  const again = (await preview.boundingBox()) ?? box;
  await page.mouse.move(again.x + 140, again.y + 60);
  await page.mouse.wheel(0, -100);
  await expect.poll(magnification).toBeLessThan(zoomed);
});

test("the stick shows the dead zone and pans only past it", async ({ page }) => {
  await page.goto("/settings/navigation");
  const stick = dialog(page).getByTestId("feel-stick");
  await stick.scrollIntoViewIfNeeded();
  const box = (await stick.boundingBox()) ?? { x: 0, y: 0, width: 64, height: 64 };
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 2, centre.y);
  await expect(stick).toHaveAttribute("data-pan-rate", "0");
  await page.mouse.move(centre.x + 24, centre.y);
  await expect
    .poll(async () => Number(await stick.getAttribute("data-pan-rate")))
    .toBeGreaterThan(0);
  await page.mouse.up();
  await expect(stick).toHaveAttribute("data-pushed", "no");
});
