import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const onHardwareGpu = process.env["PARFOCAL_GPU"] === "hardware";

test.use({
  headless: !onHardwareGpu,
  launchOptions: {
    args: [
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  },
});
test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  test.skip(
    !onHardwareGpu,
    "A second WebGPU adapter request hangs on SwiftShader while the app runs, so this runs with PARFOCAL_GPU=hardware on a real GPU",
  );
  await page.addInitScript(() => {
    window.localStorage.setItem("parfocal-developer-mode", "on");
  });
});

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 60_000,
  });
}

async function setFromOtherTab(page: Page, renderer: string) {
  await page.evaluate((value) => {
    const key = "parfocal-lab-settings";
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(key, JSON.stringify({ ...stored, renderer: value }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, renderer);
}

test("the renderer setting switches the route of an open slide and back", async ({ page }) => {
  await openSlide(page);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-renderer-route", "viv");
  const camera = await stage.getAttribute("data-camera");

  await setFromOtherTab(page, "deck");
  await expect(stage).toHaveAttribute("data-renderer-route", "deck-webgpu", { timeout: 30_000 });
  await expect(page.getByTestId("lab-route-note")).toHaveCount(0);
  expect(await page.evaluate(() => window.__parfocal?.getRoute?.())).toBe("deck-webgpu");
  await expect(page.locator("[data-testid=slide-host] canvas")).toHaveCount(1);
  expect(await stage.getAttribute("data-camera")).toBe(camera);
  await expect(stage).toHaveAttribute("data-state", "ready");

  await setFromOtherTab(page, "viv");
  await expect(stage).toHaveAttribute("data-renderer-route", "viv", { timeout: 30_000 });
  await expect(page.locator("[data-testid=slide-host] canvas")).toHaveCount(1);
  expect(await stage.getAttribute("data-camera")).toBe(camera);
});

test("a slide opened with the deck.gl setting opens on that route", async ({ page }) => {
  await page.goto("/developer");
  await page
    .getByRole("radiogroup", { name: "Renderer" })
    .getByRole("radio", { name: "deck.gl 9.4", exact: true })
    .click();
  await openSlide(page);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute(
    "data-renderer-route",
    "deck-webgpu",
  );
});
