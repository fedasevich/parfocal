import { expect, type Page, test } from "@playwright/test";

const story = (id: string, theme: "dark" | "light" = "dark") =>
  `/iframe.html?id=controls-tabs--${id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`;

const tab = (page: Page, name: string) => page.getByRole("tab", { name });

const kinds = [
  { id: "page", tabs: ["To review", "Assigned by me", "All slides"] },
  { id: "panel-with-counts", tabs: ["Objects", "Display", "Comments", "Opinion"] },
  { id: "quiet-with-counts", tabs: ["Review", "Comments", "Display"] },
] as const;

for (const kind of kinds) {
  test(`${kind.id} tabs move with the arrow keys, Home and End`, async ({ page }) => {
    await page.goto(story(kind.id));
    const names = [...kind.tabs];
    const first = names[0] as string;
    const last = names[names.length - 1] as string;
    await tab(page, first).focus();
    await expect(tab(page, first)).toHaveAttribute("aria-selected", "true");
    for (const name of names.slice(1)) {
      await page.keyboard.press("ArrowRight");
      await expect(tab(page, name)).toBeFocused();
    }
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, first)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, last)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab(page, first)).toBeFocused();
    await page.keyboard.press("End");
    await expect(tab(page, last)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tab(page, last)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      (await tab(page, last).getAttribute("id")) ?? "",
    );
  });
}

test("a disabled tab can take focus but never opens", async ({ page }) => {
  await page.goto(story("line"));
  await tab(page, "Cells").focus();
  await page.keyboard.press("End");
  await expect(tab(page, "Notes")).toBeFocused();
  await expect(tab(page, "Notes")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(tab(page, "Cells")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("1,204 cells in view.");
});

test("a tab panel takes focus from the tab list with a visible ring", async ({ page }) => {
  await page.goto(story("quiet"));
  await tab(page, "Review").focus();
  await page.keyboard.press("Tab");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeFocused();
  const ring = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(ring).toEqual({ style: "solid", width: "2px" });
});

for (const theme of ["dark", "light"] as const) {
  test(`side panel counts are badges and page counts are plain numbers in ${theme}`, async ({
    page,
  }) => {
    await page.goto(story("panel-with-counts", theme));
    const badge = await page
      .locator('[data-slot="tab-count"]')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: element.getBoundingClientRect().height,
          size: style.fontSize,
          weight: style.fontWeight,
          background: style.backgroundColor,
        };
      });
    expect(badge.height).toBe(16);
    expect(badge.size).toBe("11px");
    expect(badge.weight).toBe("600");
    expect(badge.background).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator('[data-slot="tab-count"]')).toHaveText(["12", "3"]);

    await page.goto(story("page-with-counts", theme));
    const plain = await page
      .locator('[data-slot="tab-count"]')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { size: style.fontSize, background: style.backgroundColor };
      });
    expect(plain).toEqual({ size: "12px", background: "rgba(0, 0, 0, 0)" });
    await expect(page.locator('[data-slot="tab-count"]')).toHaveText(["4", "2", "38"]);

    await page.goto(story("page", theme));
    await expect(page.locator('[data-slot="tab-count"]')).toHaveCount(0);
  });
}
