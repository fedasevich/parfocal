import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

test("compare opened from the rail wears the viewer's top bar and the mock's panel", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=review`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const viewerComments = await page
    .getByTestId("stage-inspector")
    .getByRole("tab", { name: /^Comments/ })
    .innerText();

  await page.getByTestId("rail-compare").click();
  await expect(page).toHaveURL(/scene=picking/);

  const bar = page.getByTestId("live-top-bar");
  await expect(bar.getByRole("link", { name: "My work" })).toBeVisible();
  const chip = bar.getByTestId("slide-picker");
  await expect(chip).toHaveText("A1 · H&E");
  const chipWidth = async () => (await chip.boundingBox())?.width ?? 0;
  await expect.poll(chipWidth).toBeGreaterThan(120);
  expect(await chipWidth()).toBeLessThan(165);
  await expect(bar.getByTestId("workspace-switch").getByRole("radio")).toHaveText([
    "Guided",
    "Full viewer",
  ]);

  const panel = page.getByTestId("full-viewer");
  const summary = panel.getByText("Objects on A1", { exact: true });
  const onScreen = panel.getByText("Slides on screen", { exact: true });
  await expect(summary).toBeVisible();
  await expect(onScreen).toBeVisible();
  const summaryTop = (await summary.boundingBox())?.y ?? 0;
  const onScreenTop = (await onScreen.boundingBox())?.y ?? 0;
  expect(summaryTop).toBeLessThan(onScreenTop);

  await expect(panel.locator('[data-slot="panel-section"]')).toHaveCount(3);
  await expect(panel.locator('[data-slot="zone"]')).toHaveCount(1);

  const comments = await panel.getByRole("tab", { name: /^Comments/ }).innerText();
  expect(comments).toEqual(viewerComments);
});

test("the picker says sides and the pill is 32 px tall", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&scene=picking`);
  const pill = page.locator('[data-slot="floating-pill"]');
  await expect(pill).toBeVisible();
  expect((await pill.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  await expect(page.getByRole("button", { name: "Swap sides" })).toBeVisible();
  await expect(page.getByText(/swaps the panes/)).toHaveCount(0);
});
