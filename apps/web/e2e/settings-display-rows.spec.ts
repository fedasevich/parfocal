import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const samSet = '[data-set="00000000-0000-4000-8006-000000000002"]';

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

async function openDisplay(page: Page) {
  await page.goto("/settings/display");
  await expect(dialog(page).getByRole("radiogroup", { name: "Motion" })).toBeVisible();
}

async function raise(page: Page, label: string, presses: number) {
  const slider = dialog(page).getByRole("slider", { name: label });
  await slider.focus();
  for (let press = 0; press < presses; press += 1) await slider.press("ArrowLeft");
}

const rootSize = (page: Page) =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));

test("text size scales the root font size and is kept after a reload", async ({ page }) => {
  await openDisplay(page);
  expect(await rootSize(page)).toBe(16);
  await dialog(page).getByRole("radiogroup", { name: "Text size" }).getByText("Large").click();
  await expect.poll(() => rootSize(page)).toBeCloseTo(18.4, 1);
  await expect(page.getByTestId("preview-text-size")).toHaveAttribute("data-size", "large");
  await page.reload();
  await expect.poll(() => rootSize(page)).toBeCloseTo(18.4, 1);
  await dialog(page).getByRole("radiogroup", { name: "Text size" }).getByText("Small").click();
  await expect.poll(() => rootSize(page)).toBeCloseTo(14.4, 1);
});

test("each new Display row previews itself and is kept after a reload", async ({ page }) => {
  await openDisplay(page);
  await raise(page, "Object opacity", 3);
  await expect(page.getByTestId("preview-opacity")).toHaveAttribute("data-value", "70");
  await dialog(page)
    .getByRole("radiogroup", { name: "Confidence shown as" })
    .getByText("Word")
    .click();
  await expect(page.getByTestId("preview-confidence")).toHaveAttribute("data-form", "word");
  await raise(page, "Heatmap opacity", 2);
  await expect(page.getByTestId("preview-heatmap")).toHaveAttribute("data-value", "50");
  await dialog(page)
    .getByRole("radiogroup", { name: "Heatmap colors" })
    .getByText("Inferno")
    .click();
  await expect(page.getByTestId("preview-heatmap")).toHaveAttribute("data-colormap", "inferno");
  await dialog(page)
    .getByRole("radiogroup", { name: "Class colors" })
    .getByText("Color-blind safe")
    .click();
  await expect(page.getByTestId("preview-palette")).toHaveAttribute("data-palette", "safe");
  await page.reload();
  await expect(page.getByTestId("preview-opacity")).toHaveAttribute("data-value", "70");
  await expect(page.getByTestId("preview-confidence")).toHaveAttribute("data-form", "word");
  await expect(page.getByTestId("preview-heatmap")).toHaveAttribute("data-value", "50");
  await expect(page.getByTestId("preview-heatmap")).toHaveAttribute("data-colormap", "inferno");
  await expect(page.getByTestId("preview-palette")).toHaveAttribute("data-palette", "safe");
});

test("the Display tab passes axe in both themes", async ({ page }) => {
  await openDisplay(page);
  for (const theme of ["Dark", "Light"]) {
    await dialog(page).getByRole("radiogroup", { name: "Theme" }).getByText(theme).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .exclude("[data-base-ui-focus-guard]")
      .analyze();
    expect(
      results.violations.map((violation) => ({
        rule: violation.id,
        targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 3),
      })),
      theme,
    ).toEqual([]);
  }
});

test("the viewer starts from the personal defaults and redraws with them", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    if (localStorage.getItem("parfocal.device-settings") !== null) return;
    localStorage.setItem(
      "parfocal.device-settings",
      JSON.stringify({ "display.fillOpacity": 60, "display.confidence": "word" }),
    );
  });
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.getByTestId("object-draw-layer")).toHaveAttribute("data-opacity", "60");
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  const panel = page.getByTestId("stage-display");
  await expect(panel.getByRole("radio", { name: "Word" })).toBeChecked();
  const opacity = panel.getByRole("slider", { name: "Opacity" });
  await opacity.focus();
  await opacity.press("ArrowLeft");
  await expect(page.getByTestId("object-draw-layer")).toHaveAttribute("data-opacity", "50");
});

test("a drawn cell colour follows the class palette", async ({ page }) => {
  test.setTimeout(90_000);
  const colours = async () => {
    await page.goto(`/projects/${p07}/slides/${a1}?as=DH`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.locator(`[data-testid="result-set-cells"]${samSet}`)).toHaveAttribute(
      "data-drawn",
      "outlines",
      { timeout: 15_000 },
    );
    await page.getByRole("tab", { name: "Display" }).click();
    const rows = page
      .locator(`[data-testid="class-legend"]${samSet}`)
      .getByTestId("class-legend-row");
    await expect(rows).toHaveCount(2);
    return rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-colour")));
  };
  const standard = await colours();
  await page.evaluate(() =>
    localStorage.setItem(
      "parfocal.device-settings",
      JSON.stringify({ "display.classPalette": "safe" }),
    ),
  );
  const safe = await colours();
  expect(safe).not.toEqual(standard);
  const okabeIto = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7"];
  for (const colour of safe) expect(okabeIto).toContain(colour);
});

test("a heatmap starts with the chosen colour map and opacity", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "parfocal.device-settings",
      JSON.stringify({ "display.colormap": "turbo", "display.heatmapOpacity": 40 }),
    );
  });
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  const slideId = /slides\/([^/?]+)/.exec(page.url())?.[1] ?? "";
  await page.addInitScript(
    ({ id, slide }) => {
      const grid = Array.from({ length: 64 }, (_, index) => (index % 8) * 30);
      (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
        statuses: {
          "up-heat": { kind: "result", status: "ready", slide_id: slide, result_set_id: id },
        },
        chosen: [],
        left: [],
        sets: [
          {
            id,
            project_id: "00000000-0000-4000-8003-000000000007",
            slide_id: slide,
            name: "Heatmap import",
            model_version: null,
            source: "import",
            source_file: "tumor_044_heat.tif",
            produced_at: null,
            status: "ready",
            error_code: null,
            cell_count: 0,
            region_count: 0,
            zone_count: 0,
            created_by_user_id: null,
            created_at: "2026-11-15T09:00:00+01:00",
          },
        ],
        heatmaps: {
          [id]: {
            facts: { width: 8, height: 8, level: 0, downsample: 100, mpp: null, tissue_share: 0.9 },
            grid,
          },
        },
      };
    },
    { id: "00000000-0000-4000-8009-0000000000b1", slide: slideId },
  );
  await page.reload();
  const layer = page.getByTestId("heatmap-layer");
  await expect(layer).toHaveAttribute("data-colormap", "turbo", { timeout: 15_000 });
  await expect(layer).toHaveCSS("opacity", "0.4");
});
