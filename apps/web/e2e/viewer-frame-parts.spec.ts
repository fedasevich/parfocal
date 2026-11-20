import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function openReview(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&as=LM`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

const railButton = (page: Page, tool: string) =>
  page.locator(`[data-slot="tool-rail-button"][data-tool="${tool}"]`);

test("the tabs carry the object and open comment counts", async ({ page }) => {
  await openReview(page);
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector.getByRole("tab", { name: "Objects 55", exact: true })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "Comments 3", exact: true })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "Display", exact: true })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "Opinion", exact: true })).toBeVisible();
});

test("review opens on Select, a drag still pans and Compare slides sits at the rail's foot", async ({
  page,
}) => {
  const stage = await openReview(page);
  await expect(stage).toHaveAttribute("data-tool", "select");
  await expect(railButton(page, "select")).toHaveAttribute("aria-pressed", "true");
  await expect(railButton(page, "hand")).toHaveAttribute("aria-pressed", "false");

  const cameraOf = () => page.getByTestId("slide-host").getAttribute("data-camera");
  let start = "";
  await expect
    .poll(async () => {
      const now = (await cameraOf()) ?? "";
      const steady = now !== "" && now === start;
      start = now;
      return steady;
    })
    .toBe(true);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 380, { steps: 8 });
  await expect(page.getByTestId("select-marquee")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(cameraOf).not.toBe(start);

  const rail = page.locator('[data-slot="tool-rail"]');
  await expect(rail.getByRole("button", { name: /side panel/ })).toHaveCount(0);
  const compare = rail.getByRole("button", { name: "Compare slides" });
  const railBox = (await rail.boundingBox()) ?? { y: 0, height: 0 };
  const compareBox = (await compare.boundingBox()) ?? { y: 0, height: 0 };
  expect(railBox.y + railBox.height - (compareBox.y + compareBox.height)).toBeLessThanOrEqual(16);
  await compare.click();
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page.getByRole("listbox", { name: "Slide for the right side" })).toBeVisible();
});

test("the panel has no foot and its cards are grey sections on a white panel", async ({ page }) => {
  await openReview(page);
  const dock = page.getByTestId("inspector-dock");
  const panel = page.getByTestId("stage-inspector");
  await expect(dock.getByLabel("Hide while panning")).toHaveCount(0);
  await expect(dock.getByTestId("inspector-popout")).toHaveCount(0);
  const dockBox = (await dock.boundingBox()) ?? { height: 0 };
  const panelBox = (await panel.boundingBox()) ?? { height: 1 };
  expect(Math.round(dockBox.height)).toBe(Math.round(panelBox.height));
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const card = panel.locator(".bg-surf-section").first();
  await expect(card).toHaveCSS("background-color", "rgb(244, 244, 244)");
  await expect(card).toHaveCSS("border-top-color", "rgb(228, 228, 228)");
  await expect(card).toHaveCSS("border-top-left-radius", "12px");
});

test("the magnification bar is 38 pixels tall with the mock's corner and steps", async ({
  page,
}) => {
  const stage = await openReview(page);
  const bar = page.getByTestId("magnification-bar");
  await page.mouse.move(2, 2);
  await expect(bar).not.toHaveAttribute("data-open", /.*/, { timeout: 6000 });
  await expect.poll(async () => Math.round((await bar.boundingBox())?.height ?? 0)).toBe(38);
  await expect(bar).toHaveCSS("border-top-left-radius", "10px");
  const barBox = (await bar.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const stageBox = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.round(stageBox.y + stageBox.height - (barBox.y + barBox.height))).toBe(12);
  expect(
    Math.abs(barBox.x + barBox.width / 2 - (stageBox.x + stageBox.width / 2)),
  ).toBeLessThanOrEqual(1);
  const steps = bar.locator('[data-part="presets"] button');
  await expect(steps).toHaveText(["1.25×", "2.5×", "5×", "10×", "20×", "40×"]);
});

test("a tool's hint bar stays on one line when the stage has room for it", async ({ page }) => {
  const stage = await openReview(page);
  for (const [key, tool, width, oneLineBarHeight] of [
    ["l", "ruler", 1440, 40],
    ["c", "comment", 1440, 40],
    ["s", "smart", 1920, 44],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.keyboard.press(key);
    await expect(stage).toHaveAttribute("data-tool", tool);
    const hints = page.getByTestId("context-bar");
    await expect(hints).toBeVisible();
    const box = (await hints.boundingBox()) ?? { x: 0, width: 0, height: 99 };
    expect(box.height).toBeLessThanOrEqual(oneLineBarHeight);
    const stageBox = (await stage.boundingBox()) ?? { x: 0, width: 0 };
    expect(Math.abs(box.x + box.width / 2 - (stageBox.x + stageBox.width / 2))).toBeLessThanOrEqual(
      1,
    );
    await page.keyboard.press("Escape");
    await expect(stage).toHaveAttribute("data-tool", "select");
  }
});
