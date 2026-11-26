import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";
const minimumContrast = 4.5;

test.use({ viewport: { width: 1440, height: 900 } });

for (const theme of ["dark", "light"] as const) {
  test(`a rail tooltip keeps 4.5 to 1 contrast for its name and its hint in the ${theme} theme`, async ({
    page,
  }) => {
    await page.goto(`/projects/${p07}/slides/${tumor044}?task=${rt14}&mode=annotate`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 20_000,
    });
    await page.evaluate((choice) => {
      document.documentElement.dataset["theme"] = choice;
    }, theme);
    const comment = page.locator('[data-slot="tool-rail-button"][data-tool="comment"]');
    await comment.click();
    await expect(page.getByText("Click to pin a thread").first()).toBeVisible();
    await comment.click();
    await page.mouse.move(0, 0);
    await comment.hover();
    const hint = page.locator('[data-slot="tool-rail-hint"]');
    await expect(hint).toHaveText("Click to pin a thread. Enter posts");

    const ratios = await page.evaluate(() => {
      const popup = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
      const note = document.querySelector<HTMLElement>('[data-slot="tool-rail-hint"]');
      if (!popup || !note) throw new Error("no tooltip");
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no canvas");
      const channels = (colour: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = colour;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const luminance = (rgb: number[]) => {
        const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
          const unit = channel / 255;
          return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (text: string, surface: string) => {
        const a = luminance(channels(text));
        const b = luminance(channels(surface));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const surface = getComputedStyle(popup).backgroundColor;
      return {
        name: contrast(getComputedStyle(popup).color, surface),
        hint: contrast(getComputedStyle(note).color, surface),
      };
    });
    expect(ratios.name).toBeGreaterThanOrEqual(minimumContrast);
    expect(ratios.hint).toBeGreaterThanOrEqual(minimumContrast);
  });
}
