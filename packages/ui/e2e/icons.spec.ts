import { expect, test } from "@playwright/test";

const story = (id: string) =>
  `/iframe.html?id=foundations-icons--${id}&viewMode=story&globals=a11y.manual:!true`;

test("every icon in the set renders with an accessible name", async ({ page }) => {
  await page.goto(story("every-icon"));
  const cells = page.locator("[data-icon-cell]");
  await expect(cells.first()).toBeVisible();
  const seen = await cells.evaluateAll((items) =>
    items.map((item) => {
      const svg = item.querySelector("svg");
      return {
        name: item.getAttribute("data-icon-cell"),
        label: svg?.getAttribute("aria-label") ?? "",
        hidden: svg?.getAttribute("aria-hidden"),
        width: svg?.getBoundingClientRect().width,
      };
    }),
  );
  expect(seen.length).toBeGreaterThan(60);
  for (const icon of seen) {
    expect(icon.label.length, `${icon.name} has a name`).toBeGreaterThan(1);
    expect(icon.hidden).toBeNull();
    expect(icon.width).toBe(20);
  }
});

test("the five sizes draw at 12, 16, 20, 24 and 40 pixels", async ({ page }) => {
  await page.goto(story("sizes"));
  const icons = page.locator('svg[data-slot="icon"]');
  await expect(icons).toHaveCount(5);
  const widths = await icons.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().width),
  );
  expect(widths).toEqual([12, 16, 20, 24, 40]);
});

test("tool badges and names follow the person's key bindings", async ({ page }) => {
  await page.goto(story("tool-keys"));
  const buttons = page.locator('[data-slot="tool-rail-button"]');
  await expect(buttons.nth(0)).toHaveAccessibleName("Select (Q)");
  await expect(buttons.nth(1)).toHaveAccessibleName("Ruler (M)");
  await expect(buttons.nth(1).locator("span[aria-hidden]")).toHaveText("M");
  await buttons.nth(1).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Ruler · M");
});
