import { expect, type Page, test } from "./a11y.ts";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

const previewed: { section: string; groups: string[] }[] = [
  { section: "display", groups: ["Theme", "Density"] },
  {
    section: "layout",
    groups: ["Home", "Tools", "Side panel width", "Panel while moving", "Minimap"],
  },
];

for (const { section, groups } of previewed) {
  test(`every layout choice in ${section} shows a preview of what it looks like`, async ({
    page,
  }) => {
    await page.goto(`/settings/${section}`);
    for (const name of groups) {
      const choice = dialog(page).getByRole("radiogroup", { name, exact: true });
      await expect(choice).toBeVisible();
      const radios = choice.getByRole("radio");
      const count = await radios.count();
      expect(count, name).toBeGreaterThan(1);
      for (let index = 0; index < count; index += 1) {
        await expect(radios.nth(index).locator('[data-slot="setting-preview"]')).toBeVisible();
      }
    }
  });
}

test("the tools choice previews the left rail and the bottom dock", async ({ page }) => {
  await page.goto("/settings/layout");
  const tools = dialog(page).getByRole("radiogroup", { name: "Tools", exact: true });
  await expect(tools.getByRole("radio", { name: "Left rail" })).toBeVisible();
  await expect(tools.locator('[data-preview="tools:rail"]')).toBeVisible();
  await expect(tools.locator('[data-preview="tools:dock"]')).toBeVisible();
});

for (const section of ["display", "layout", "navigation"]) {
  test(`rows in ${section} show their scope as an icon the legend explains`, async ({ page }) => {
    await page.goto(`/settings/${section}`);
    const rows = dialog(page).locator('[data-slot="settings-row"]');
    await expect(rows.first()).toBeVisible();
    const scopes = rows.locator('[data-slot="setting-scope"]');
    expect(await scopes.count()).toBe(await rows.count());
    for (const text of await scopes.allInnerTexts()) expect(text.trim()).toBe("");
    for (const label of await scopes.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    )) {
      expect(["Personal", "This computer", "Set by your lab"]).toContain(label);
    }
    const legend = dialog(page).locator('[data-slot="settings-scope-legend"]');
    await expect(legend).toContainText("Personal");
    await expect(legend).toContainText("This computer");
    await expect(legend).toContainText("Set by your lab");
  });
}

const toolsNote = "The bottom dock gives the slide its full height.";

test("a row's explanation shows once, then lives behind the label until shown again", async ({
  page,
}) => {
  await page.goto("/settings/layout");
  const tools = dialog(page)
    .locator('[data-slot="settings-row"]')
    .filter({ has: page.getByRole("radiogroup", { name: "Tools", exact: true }) });
  await expect(tools.locator('[data-slot="setting-note"]')).toContainText(toolsNote);
  await page.reload();
  await expect(tools.locator('[data-slot="setting-note"]')).toContainText(toolsNote);
  await tools.getByRole("radio", { name: "Bottom dock" }).click();
  await expect(tools.locator('[data-slot="setting-note"]')).toContainText(toolsNote);

  const nav = dialog(page).getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("button", { name: "Display" }).click();
  await nav.getByRole("button", { name: "Layout" }).click();
  await expect(tools.locator('[data-slot="setting-note"]')).toHaveCount(0);
  const label = tools.locator('[data-slot="setting-note-trigger"]');
  await expect(label).toHaveAccessibleDescription(new RegExp(toolsNote));
  await label.hover();
  const popover = page.locator('[data-slot="setting-note-popover"]');
  await expect(popover).toContainText(toolsNote);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();

  await page.reload();
  await expect(label).toBeVisible();
  await label.focus();
  await expect(popover).toContainText(toolsNote);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();

  await nav.getByRole("button", { name: "Display" }).click();
  await dialog(page).getByRole("button", { name: "Show all hints again" }).click();
  await nav.getByRole("button", { name: "Layout" }).click();
  await expect(tools.locator('[data-slot="setting-note"]')).toContainText(toolsNote);
});

test("lab reasons stay under their row after the section was seen", async ({ page }) => {
  await page.goto("/settings/ai");
  const nav = dialog(page).getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("button", { name: "Display" }).click();
  await nav.getByRole("button", { name: "AI and confidence" }).click();
  await expect(dialog(page)).toContainText("Set by your lab. Outlines scoring under it are faded");
});
