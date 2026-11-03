import { surfaceLevels, surfaceSpacingRulesPx } from "@parfocal/tokens";
import { expect, type Page, test } from "@playwright/test";

const story = (id: string, theme: string) =>
  `/iframe.html?id=components-surfaces--${id}&viewMode=story&globals=a11y.manual:!true;theme:${theme}`;

const within = (value: number, rule: { min: number; max: number }) =>
  value >= rule.min && value <= rule.max;

const modalShape = (page: Page) =>
  page.evaluate(() => {
    const popup = document.querySelector("[data-slot=job-window]");
    const body = popup?.children[1];
    if (!(popup instanceof HTMLElement) || !(body instanceof HTMLElement)) {
      throw new Error("missing modal body");
    }
    const zones = [...body.children] as HTMLElement[];
    const style = getComputedStyle(body);
    const boxes = zones.map((zone) => zone.getBoundingClientRect());
    const hints = [...(zones[0]?.querySelectorAll("[data-slot=hint]") ?? [])].map((hint) =>
      hint.getBoundingClientRect(),
    );
    return {
      padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((side) =>
        Number.parseFloat(style[side as "paddingTop"]),
      ),
      gaps: boxes.slice(1).map((box, index) => box.top - (boxes[index]?.bottom ?? 0)),
      inner: (hints[1]?.top ?? 0) - (hints[0]?.bottom ?? 0),
      panel: getComputedStyle(popup).backgroundColor,
      backgrounds: zones.map((zone) => getComputedStyle(zone).backgroundColor),
      slots: zones.map((zone) => zone.dataset.slot),
    };
  });

for (const theme of ["dark", "light"] as const) {
  test(`a modal splits into three zones by background in ${theme}`, async ({ page }) => {
    await page.goto(story("modal-with-three-zones", theme));
    await expect(page.locator("[data-slot=job-window]")).toBeVisible();
    const shape = await modalShape(page);
    expect(shape.slots).toEqual(["zone", "zone", "folding-zone"]);
    for (const side of shape.padding) {
      expect(within(side, surfaceSpacingRulesPx["pad-modal"])).toBe(true);
    }
    expect(shape.gaps).toHaveLength(2);
    for (const gap of shape.gaps) {
      expect(within(Math.round(gap), surfaceSpacingRulesPx["space-zone"])).toBe(true);
    }
    expect(within(Math.round(shape.inner), surfaceSpacingRulesPx["space-in"])).toBe(true);
    const [section, highlight, folded] = shape.backgrounds;
    expect(section).toBe(folded);
    expect(new Set([shape.panel, section, highlight]).size).toBe(3);
    await expect(page.getByText("Outline 2 px · by class · IDs on")).toBeVisible();
    await page.getByRole("button", { name: /Display/ }).click();
    await expect(page.getByText("Outline 2 px · by class · IDs on")).toBeHidden();
    await expect(page.getByRole("switch", { name: "ID labels" })).toBeVisible();
  });
}

test("every surface level has its own colour in both themes", async ({ page }) => {
  await page.goto(story("every-level", "dark"));
  await expect(page.getByTestId("level-light-highlight")).toBeVisible();
  const colours = await page.evaluate(
    (levels) =>
      Object.fromEntries(
        ["dark", "light"].map((theme) => [
          theme,
          levels.map((level) => {
            const node = document.querySelector(`[data-testid=level-${theme}-${level}]`);
            if (node === null) throw new Error(`missing ${theme} ${level}`);
            return getComputedStyle(node).backgroundColor;
          }),
        ]),
      ),
    [...surfaceLevels],
  );
  for (const theme of ["dark", "light"]) {
    expect(new Set(colours[theme]).size).toBe(surfaceLevels.length);
  }
  expect(colours.dark).not.toEqual(colours.light);
});
