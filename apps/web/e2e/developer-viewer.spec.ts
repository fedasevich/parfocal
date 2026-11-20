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

const taskSlide = `/projects/${p07}/slides/00000000-0000-4000-8005-000000000005?task=00000000-0000-4000-8007-000000000021&as=DH`;

async function openTaskSlide(page: Page) {
  await page.goto(taskSlide);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
}

test("the palette opens the drawer over the panel tabs and its controls drive the slide", async ({
  page,
}) => {
  await openTaskSlide(page);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  await palette.getByRole("combobox").fill("developer");
  await palette.getByRole("option", { name: /^Developer mode/ }).click();
  const drawer = page.getByRole("dialog", { name: "Developer" });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/\/slides\//);
  const tabs = page.getByTestId("stage-inspector").getByRole("tab").first();
  const box = await tabs.boundingBox();
  const covered = box
    ? await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest("[data-slot=developer-drawer]") !== null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )
    : false;
  expect(covered).toBe(true);
  await drawer
    .getByRole("radiogroup", { name: "Renderer" })
    .getByRole("radio", { name: "WebGPU" })
    .click();
  await expect(page.getByTestId("lab-route-note")).toContainText("Showing Viv");
  await drawer.getByRole("radio", { name: "None", exact: true }).click();
  await expect(page.getByTestId("lab-nuclei")).toHaveAttribute("data-cull", "off");
  await drawer.getByRole("button", { name: "Close developer mode" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("lab-nuclei")).toHaveAttribute("data-cull", "off");
});

test("Ctrl+Shift+D toggles the drawer on a slide and it stays open across reloads", async ({
  page,
}) => {
  await openTaskSlide(page);
  await page.keyboard.press("Control+Shift+D");
  const drawer = page.getByRole("dialog", { name: "Developer" });
  await expect(drawer).toBeVisible();
  await page.reload();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Control+Shift+D");
  await expect(drawer).toHaveCount(0);
});

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
