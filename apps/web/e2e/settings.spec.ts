import { expect, test } from "@playwright/test";

const settingsScenes: { scene: string; section: string; title: string; shows: string }[] = [
  { scene: "display", section: "display", title: "Display", shows: "Slide brightness" },
  { scene: "review", section: "review", title: "Review", shows: "Edit in the Display panel" },
  { scene: "layout", section: "layout", title: "Layout", shows: "Pinned slide strip" },
  { scene: "ai", section: "ai", title: "AI and confidence", shows: "Default display preset" },
  {
    scene: "nav",
    section: "navigation",
    title: "Navigation and devices",
    shows: "SpaceMouse rotation",
  },
  {
    scene: "notify",
    section: "notifications",
    title: "Notifications",
    shows: "A model run finishes",
  },
  {
    scene: "privacy",
    section: "privacy",
    title: "Privacy and session",
    shows: "a Windows workstation in room 214 and an iPad",
  },
  { scene: "account", section: "account", title: "Account", shows: "Consultant · breast, nodes" },
  {
    scene: "search",
    section: "navigation",
    title: "Navigation and devices",
    shows: 'Matching "zoom"',
  },
  { scene: "keys", section: "shortcuts", title: "Shortcuts", shows: "in the style Yes or no" },
  { scene: "changed", section: "shortcuts", title: "Shortcuts", shows: "default L" },
  {
    scene: "recording",
    section: "shortcuts",
    title: "Shortcuts",
    shows: "Press the new key for ruler",
  },
  {
    scene: "conflict",
    section: "shortcuts",
    title: "Shortcuts",
    shows: "M is already count marker in tools",
  },
  { scene: "reserved", section: "shortcuts", title: "Shortcuts", shows: "The browser keeps ⌘W" },
  {
    scene: "safety",
    section: "shortcuts",
    title: "Shortcuts",
    shows: "Sign out the case needs ⌘ or ⌃",
  },
  { scene: "findkey", section: "shortcuts", title: "Shortcuts", shows: "What L does" },
];

const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Settings" });

test("every settings and shortcuts scene opens on fake data", async ({ page }) => {
  for (const { scene, section, title, shows } of settingsScenes) {
    await page.goto(`/settings/${section}?scene=${scene}`);
    await expect(dialog(page).getByRole("heading", { name: title, level: 2 })).toBeVisible();
    await expect(dialog(page).getByText(shows).first()).toBeVisible();
  }
});

test("every developer scene opens", async ({ page }) => {
  const scenes: [string, string][] = [
    ["renderer", "Viv switches"],
    ["tiles", "Sample slides"],
    ["annot", "Synthetic nuclei"],
    ["heatmap", "Colormap"],
    ["models", "MONAI server"],
    ["typing", "Cell typing"],
    ["job", "Tile 712 of 1,880, tumor first"],
    ["bench", "Pan sweep"],
    ["hud", "Readouts on the Viv route"],
    ["ref", "Debug handle"],
    ["webgpu", "Back to Viv"],
  ];
  for (const [scene, shows] of scenes) {
    await page.goto(`/developer?scene=${scene}`);
    const drawer = page.getByRole("dialog", { name: "Developer" });
    await expect(drawer.getByText(shows).first()).toBeVisible();
  }
});

test("the account menu opens Settings and Shortcuts, and close goes back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await expect(page).toHaveURL(/\/settings\/shortcuts$/);
  await expect(dialog(page).getByRole("heading", { name: "Shortcuts" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close settings" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await expect(page).toHaveURL(/\/settings\/display$/);
  await dialog(page).getByRole("button", { name: "Layout" }).click();
  await expect(page).toHaveURL(/\/settings\/layout$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
});

test("recording a key walks through the mock's cases", async ({ page }) => {
  await page.goto("/settings/shortcuts");
  await dialog(page).getByRole("button", { name: "Comment: C" }).click();
  await expect(dialog(page).getByText("Press the new key for comment")).toBeVisible();
  await page.keyboard.press("Meta+w");
  await expect(dialog(page).getByText("The browser keeps ⌘W")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Ruler: L" }).click();
  await page.keyboard.press("m");
  await dialog(page).getByRole("button", { name: "Swap: count marker gets L" }).click();
  await expect(dialog(page).getByRole("button", { name: "Ruler: M" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Count marker: L" })).toBeVisible();
  await dialog(page).getByRole("radio", { name: "Changed 2" }).click();
  await expect(dialog(page).getByText("default L")).toBeVisible();
});

test("search filters the sections and Esc clears it", async ({ page }) => {
  await page.goto("/settings/display");
  await dialog(page).getByRole("searchbox", { name: "Search settings" }).fill("zoom");
  await expect(
    dialog(page).getByRole("navigation", { name: "Settings sections" }).getByRole("button"),
  ).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(dialog(page).getByRole("heading", { name: "Display" })).toBeVisible();
});

test("signing out other devices leaves only this one", async ({ page }) => {
  await page.goto("/settings/privacy");
  await dialog(page).getByRole("button", { name: "Sign out on other devices" }).click();
  await expect(dialog(page).getByText("Only this device")).toBeVisible();
  await expect(dialog(page).getByText(/Signed out of 2 other devices at/)).toBeVisible();
});
