import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const minimumContrast = 4.5;

const backdrops = [
  { name: "white", rgb: [255, 255, 255] },
  { name: "pink", rgb: [236, 150, 178] },
  { name: "dark purple", rgb: [59, 7, 100] },
] as const;

async function placeText(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("t");
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.keyboard.type("Check this border with a second expert");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("text-shape")).toHaveCount(1);
}

for (const theme of ["light", "dark"] as const) {
  test(`a text annotation keeps 4.5 to 1 contrast over white, pink and dark purple in the ${theme} theme`, async ({
    page,
  }) => {
    await placeText(page);
    await page.evaluate((choice) => {
      document.documentElement.dataset["theme"] = choice;
    }, theme);

    for (const backdrop of backdrops) {
      const ratio = await page.evaluate(
        ([rgb]) => {
          const label = document.querySelector<HTMLElement>('[data-testid="text-shape"]');
          const layer = document.querySelector<HTMLElement>('[data-testid="text-layer"]');
          if (!label || !layer) throw new Error("no text annotation");
          layer.style.backgroundColor = `rgb(${rgb.join(",")})`;
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("no canvas");
          const style = getComputedStyle(label);
          const pixel = (fill: string, under: string | null) => {
            context.clearRect(0, 0, 1, 1);
            if (under !== null) {
              context.fillStyle = under;
              context.fillRect(0, 0, 1, 1);
            }
            context.fillStyle = fill;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
          };
          const plateRgb = pixel(style.backgroundColor, `rgb(${rgb.join(",")})`);
          const text = { rgb: pixel(style.color, null) };
          const luminance = (channels: number[]) => {
            const [r = 0, g = 0, b = 0] = channels.map((channel) => {
              const unit = channel / 255;
              return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const light = Math.max(luminance(plateRgb), luminance(text.rgb));
          const dark = Math.min(luminance(plateRgb), luminance(text.rgb));
          return (light + 0.05) / (dark + 0.05);
        },
        [backdrop.rgb],
      );
      expect(ratio, backdrop.name).toBeGreaterThanOrEqual(minimumContrast);
    }
  });
}
