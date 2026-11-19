import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";

async function openReviewDisplay(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  const panel = page.getByTestId("stage-display");
  await expect(panel).toBeVisible();
  return panel;
}

const layer = (page: Page) => page.getByTestId("object-draw-layer");

test("the Display tab holds the preset and the mock's groups, and each control reaches the overlay", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openReviewDisplay(page);
  await expect(panel.getByText("Preset", { exact: true })).toBeVisible();
  await expect(panel.getByText("How objects draw")).toBeVisible();
  await expect(panel.getByText("What the AI shows")).toBeVisible();
  await expect(layer(page)).toHaveAttribute("data-draw", "outline");
  await expect(layer(page)).toHaveAttribute("data-ids", "true");

  const drawAs = panel.getByRole("radiogroup", { name: "Draw as" });
  await drawAs.getByText("Dots").click();
  await expect(layer(page)).toHaveAttribute("data-draw", "dots");
  await drawAs.getByText("Fill").click();
  await expect(layer(page)).toHaveAttribute("data-draw", "fill");

  await panel.getByRole("radiogroup", { name: "Width" }).getByText("3 px").click();
  await expect(layer(page)).toHaveAttribute("data-width", "3");

  const opacity = panel.getByRole("slider", { name: "Opacity" });
  await opacity.focus();
  await opacity.press("ArrowLeft");
  await opacity.press("ArrowLeft");
  await expect(layer(page)).toHaveAttribute("data-opacity", "80");

  await panel.getByRole("radiogroup", { name: "Color by" }).getByText("Decision").click();
  await expect(layer(page)).toHaveAttribute("data-color-by", "decision");
  await expect(page.getByTestId("review-object-outlines")).toHaveAttribute(
    "data-color-by",
    "decision",
  );

  await panel.getByRole("switch").first().click();
  await expect(layer(page)).toHaveAttribute("data-ids", "false");
  await expect(page.getByTestId("slide-marks")).toHaveAttribute("data-ids", "false");
  await expect(page.getByTestId("region-tag")).toHaveCount(0);

  const before = Number(await layer(page).getAttribute("data-cutoff"));
  const belowBefore = Number(await layer(page).getAttribute("data-below-cutoff"));
  const cutoff = panel.getByRole("slider", { name: "Score cutoff" });
  await cutoff.focus();
  for (let step = 0; step < 6; step += 1) await cutoff.press("ArrowRight");
  await expect(layer(page)).not.toHaveAttribute("data-cutoff", String(before));
  expect(Number(await layer(page).getAttribute("data-cutoff"))).toBeGreaterThan(before);
  expect(Number(await layer(page).getAttribute("data-below-cutoff"))).toBeGreaterThanOrEqual(
    belowBefore,
  );
});

test("a preset redraws the overlay and the map buttons sit under What the AI shows", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openReviewDisplay(page);
  const extras = panel.getByTestId("display-ai-extras");
  await expect(extras.getByRole("button", { name: "Colour tumor in this view" })).toBeVisible();
  await expect(extras.getByRole("button", { name: /Brush your own map/ })).toBeVisible();

  await panel.getByRole("button", { name: /Task default/ }).click();
  await page.getByRole("menuitemradio", { name: /Dots, no IDs/ }).click();
  await expect(layer(page)).toHaveAttribute("data-draw", "dots");
  await expect(layer(page)).toHaveAttribute("data-ids", "false");
  await expect(panel.getByRole("button", { name: /Dots, no IDs/ })).toBeVisible();
});
