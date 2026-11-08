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

for (const { scene, section, title, shows } of settingsScenes) {
  test(`the ${section} ${scene} settings scene opens on fake data`, async ({ page }) => {
    await page.goto(`/settings/${section}?scene=${scene}`);
    await expect(dialog(page).getByRole("heading", { name: title, level: 2 })).toBeVisible();
    await expect(dialog(page).getByText(shows).first()).toBeVisible();
  });
}

const developerScenes: [string, string][] = [
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

for (const [scene, shows] of developerScenes) {
  test(`the ${scene} developer scene opens`, async ({ page }) => {
    await page.goto(`/developer?scene=${scene}`);
    const drawer = page.getByRole("dialog", { name: "Developer" });
    await expect(drawer.getByText(shows).first()).toBeVisible();
  });
}

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

test("an edited name is saved and still shown after a reload", async ({ page }) => {
  await page.goto("/settings/account");
  const name = dialog(page).getByRole("textbox", { name: "Name" });
  await name.fill("Lenka Malá-Nová");
  await name.press("Enter");
  await expect(page.getByText("Name saved")).toBeVisible();
  await page.reload();
  await expect(dialog(page).getByRole("textbox", { name: "Name" })).toHaveValue("Lenka Malá-Nová");
  await expect(dialog(page).getByText(/Signs reports as Lenka Malá-Nová/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByTestId("account-name")).toHaveText("Lenka Malá-Nová");
});

test("an empty name is refused and the old one stays", async ({ page }) => {
  await page.goto("/settings/account");
  const name = dialog(page).getByRole("textbox", { name: "Name" });
  await name.fill("  ");
  await name.press("Enter");
  await expect(page.getByText("Your name can't be empty")).toBeVisible();
  await expect(name).toHaveValue("Lenka Malá");
});

test("silencing replies in Settings hides them from the bell", async ({ page }) => {
  await page.goto("/settings/notifications");
  const replies = dialog(page).getByRole("radiogroup", { name: "Someone replies to me" });
  await replies.getByRole("radio", { name: "Quiet" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Notifications, / }).click();
  const bell = page.getByRole("dialog", { name: "Notifications" });
  await expect(bell.getByText("Simona Marková replied")).toHaveCount(0);
  await expect(bell.getByText("PathoSAM + HoVer-NeXt finished")).toBeVisible();
});

test("the STAT rows and sound are offered", async ({ page }) => {
  await page.goto("/settings/notifications");
  await expect(dialog(page).getByText("A STAT task is given to me")).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: "Sound for STAT tasks" })).toBeChecked();
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

test("the Privacy section shows initials, lock after and the patient banner", async ({ page }) => {
  await page.goto("/settings/privacy");
  const initials = dialog(page).getByRole("switch", { name: "Initials while sharing" });
  const before = await initials.getAttribute("aria-checked");
  await initials.click();
  await expect(initials).not.toHaveAttribute("aria-checked", before ?? "");
  await expect(dialog(page).getByText(/^\d+ min$/)).toBeVisible();
  await expect(dialog(page).getByText(/^(Shown with|Hidden)/)).toBeVisible();
});

test("signing out other devices leaves only this one", async ({ page }) => {
  await page.goto("/settings/privacy");
  await dialog(page).getByRole("button", { name: "Sign out on other devices" }).click();
  await expect(dialog(page).getByText("Only this device")).toBeVisible();
  await expect(dialog(page).getByText(/Signed out of 2 other devices at/)).toBeVisible();
});

test("rebinding J in Settings changes the key shown on Skip for now", async ({ page }) => {
  await page.goto(
    "/tasks/00000000-0000-4000-8007-000000000014/guided?slide=00000000-0000-4000-8005-000000000001&scene=region",
  );
  const skip = page.getByRole("button", { name: /Skip for now/ });
  await expect(skip.locator("kbd")).toHaveText("J");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await dialog(page).getByRole("button", { name: "Skip for now, next object: J" }).click();
  await page.keyboard.press("w");
  await expect(
    dialog(page).getByRole("button", { name: "Skip for now, next object: W" }),
  ).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close settings" }).click();
  await expect(skip.locator("kbd")).toHaveText("W");
});

test("Cmd+comma opens Settings over the live screen and a backdrop click closes it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(async () => {
    if (!/\/settings\/display$/.test(page.url())) await page.keyboard.press("Meta+,");
    await expect(page).toHaveURL(/\/settings\/display$/, { timeout: 1000 });
  }).toPass();
  await expect(dialog(page).getByText("Who a setting applies to")).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog(page)).toHaveCount(0);
});

test("the window keeps one size and place on every section", async ({ page }) => {
  await page.goto("/settings/display");
  const nav = dialog(page).getByRole("navigation", { name: "Settings sections" });
  await expect(dialog(page)).toBeVisible();
  await expect(async () => {
    const box = await dialog(page).boundingBox();
    expect(box?.width).toBe(960);
    expect(box?.x).toBe(160);
  }).toPass();
  const first = await dialog(page).boundingBox();
  const sections = await nav.getByRole("button").allInnerTexts();
  expect(sections.length).toBeGreaterThan(5);
  for (const name of sections) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(dialog(page).getByRole("heading", { level: 2 })).toBeVisible();
    expect(await dialog(page).boundingBox()).toEqual(first);
  }
});

test("the question mark key opens Shortcuts with the source badges", async ({ page }) => {
  await page.goto("/");
  await expect(async () => {
    if (!/\/settings\/shortcuts$/.test(page.url())) await page.keyboard.press("Shift+?");
    await expect(page).toHaveURL(/\/settings\/shortcuts$/, { timeout: 1000 });
  }).toPass();
  const shortcuts = dialog(page);
  await expect(shortcuts.getByRole("heading", { name: "Shortcuts" })).toBeVisible();
  for (const name of ["Whole slide", "Shortcut sheet", "Find any action", "Undo"]) {
    await expect(shortcuts.getByText(name).first()).toBeAttached();
  }
  for (const source of ["Figma", "QuPath", "ours"]) {
    await expect(shortcuts.getByText(source, { exact: true }).first()).toBeAttached();
  }
});
