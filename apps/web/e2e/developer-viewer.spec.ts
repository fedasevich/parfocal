import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

test.beforeEach(async ({ page }) => {
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
    timeout: 15_000,
  });
}

test("the saved defaults show the HUD and the synthetic nuclei in the viewer", async ({ page }) => {
  await openSlide(page);
  await expect(page.getByTestId("lab-hud")).toBeVisible();
  await expect(page.getByTestId("lab-nuclei")).toHaveAttribute("data-count", "100000");
  await expect(page.getByTestId("lab-chip")).toContainText("100,000 nuclei");
  await expect(page.getByTestId("lab-route-note")).toHaveCount(0);
});

test("turning the HUD off in the drawer hides it in the viewer", async ({ page }) => {
  await page.goto("/developer?section=hud");
  await page.getByRole("switch", { name: "Show the HUD" }).click();
  await openSlide(page);
  await expect(page.getByTestId("lab-nuclei")).toBeAttached();
  await expect(page.getByTestId("lab-hud")).toHaveCount(0);
});

test("choosing an unbuilt renderer keeps Viv and says so", async ({ page }) => {
  await page.goto("/developer");
  await page
    .getByRole("radiogroup", { name: "Renderer" })
    .getByRole("radio", { name: "WebGPU" })
    .click();
  await openSlide(page);
  await expect(page.getByTestId("lab-route-note")).toContainText("Showing Viv");
});

test("a smaller nuclei count and no culling change what the viewer draws", async ({ page }) => {
  await page.goto("/developer?section=annot");
  await page.getByRole("combobox", { name: "Count" }).click();
  await page.getByRole("option", { name: "10k" }).click();
  await page.goto("/developer?renderer=webgpu");
  await page.getByRole("radio", { name: "None", exact: true }).click();
  await openSlide(page);
  const layer = page.getByTestId("lab-nuclei");
  await expect(layer).toHaveAttribute("data-count", "10000");
  await expect(layer).toHaveAttribute("data-cull", "off");
  await expect(layer).toHaveAttribute("data-drawn", "10000");
});
