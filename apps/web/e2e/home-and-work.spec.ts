import { expect, type Page, test } from "./a11y.ts";

const badge = (page: Page) => page.getByTestId("fake-data-badge");

test("every home and My work scene opens on fake data", async ({ page }) => {
  const scenes: { path: string; heading: string; shows: string }[] = [
    { path: "/", heading: "Good afternoon, Lenka", shows: "Continue where you left off" },
    { path: "/?scene=new", heading: "Welcome to Parfocal, Lenka", shows: "Getting started" },
    { path: "/my-work?tab=review", heading: "My work", shows: "Continue reviewing" },
    { path: "/my-work?scene=preview", heading: "My work", shows: "Continue in guided review" },
    { path: "/my-work?scene=anna", heading: "My work", shows: "Decide 3 objects on RT-14" },
    { path: "/my-work?tab=assigned", heading: "My work", shows: "7 disagreements" },
    { path: "/my-work?tab=all", heading: "My work", shows: "tumor_090" },
    { path: "/my-work?scene=allpreview", heading: "My work", shows: "Open in the full viewer" },
    { path: "/my-work?tab=all&open=notifications", heading: "My work", shows: "Mark all read" },
    {
      path: "/my-work?open=palette&find=meas",
      heading: "My work",
      shows: "Lengths",
    },
  ];
  for (const { path, heading, shows } of scenes) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true, includeHidden: true }),
    ).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    await expect(badge(page)).toContainText("Fake data");
  }
});

test("home shows the week, what is coming up and the projects, and links onward", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Thursday 15 October · 1 task in progress · 2 mentions"),
  ).toBeVisible();
  const week = page.getByRole("region", { name: "This week in your projects" });
  await expect(week).toContainText("147");
  await expect(week).toContainText("81%");
  await expect(page.getByRole("region", { name: "Coming up" })).toContainText(
    "7 of 12 done · due Fri 23 Oct",
  );
  await expect(page.getByText("48 of 55 objects decided")).toBeVisible();
  await page
    .getByRole("region", { name: "Coming up" })
    .getByRole("button", { name: "My work" })
    .click();
  await expect(page).toHaveURL(/\/my-work$/);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Good afternoon, Lenka" })).toBeVisible();
  await page.getByRole("button", { name: "Continue ↵" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/guided\?slide=/);
});

test("My work switches tabs and personas like the mock, and the preview follows the keys", async ({
  page,
}) => {
  await page.goto("/my-work?tab=review");
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("LM");
  await page.getByRole("tab", { name: /Assigned by me/ }).click();
  await expect(page).toHaveURL(/tab=assigned/);
  await expect(badge(page)).toContainText("viewing as Daniel Hruška");
  await expect(page.getByRole("row")).toHaveCount(5);
  await expect(page.getByRole("row", { name: /RT-11/ })).toContainText("Signed off 14 Oct");
  await page.getByRole("tab", { name: /To review/ }).click();
  await expect(badge(page)).toHaveText("Fake data");
  await page.getByRole("option", { name: /Round 2 · CAMELYON v1.0/ }).click();
  const preview = page.getByRole("complementary", { name: "Preview of A1" });
  await expect(preview).toContainText("48 of 55 objects decided");
  await expect(preview).toContainText("3 threads");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await page.getByRole("tab", { name: /All slides/ }).click();
  await page.getByRole("row", { name: /tumor_044/ }).click();
  await expect(page.getByRole("complementary", { name: "Preview of tumor_044" })).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("complementary", { name: "Preview of tumor_031" })).toBeVisible();
  await page.getByRole("textbox", { name: "Find a slide, case or ID" }).fill("tumor");
  await expect(page.locator("tbody tr")).toHaveCount(4);
});

test("Anna sees her adjudication entry and nothing to read", async ({ page }) => {
  await page.goto("/my-work?scene=anna");
  await expect(badge(page)).toContainText("viewing as Anna Kopecká");
  await expect(page.getByText("asked by Daniel Hruška · T4, T5 and T1·C145 on A1")).toBeVisible();
  await expect(page.getByText("Nothing new for you.")).toBeVisible();
  await page
    .getByRole("option", { name: /Decide 3 objects/ })
    .getByRole("button", { name: "Start" })
    .click();
  await expect(page).toHaveURL(/\/disagreements\?scene=adjudicate$/);
});

test("the bell filters, opens an item and marks everything read", async ({ page }) => {
  await page.goto("/my-work");
  await page.getByRole("button", { name: "Notifications, 5 unread" }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByTestId("notification")).toHaveCount(7);
  await panel.getByRole("radio", { name: /Mentions/ }).click();
  await expect(panel.getByTestId("notification")).toHaveCount(2);
  await panel.getByRole("radio", { name: /For me/ }).click();
  await panel.getByRole("button", { name: "Mark all read" }).click();
  await expect(panel.getByText("All read")).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications, 0 unread" })).toBeVisible();
  await panel.getByRole("button", { name: "Open the report" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/evaluation$/);
});

test("a mention opened from the bell on Home lands on its thread and is marked read", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Notifications, 5 unread" }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await panel.getByRole("radio", { name: /Mentions/ }).click();
  await expect(panel.getByTestId("notification")).toHaveCount(2);
  await panel
    .getByTestId("notification")
    .filter({ hasText: "Daniel Hruška mentioned you" })
    .getByRole("button", { name: "Open the thread" })
    .click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/comments\?.*thread=T2/);
  await expect(page.getByRole("region", { name: "Thread on T2" })).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Notifications, 4 unread" })).toBeVisible();
});

test("See all in the bell goes to My work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page
    .getByRole("dialog", { name: "Notifications" })
    .getByRole("button", { name: "See all" })
    .click();
  await expect(page).toHaveURL(/\/my-work/);
});

test("the palette opens from the search box and ⌘K, finds places and runs on Enter", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search projects, slides, IDs/ }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("sentinel");
  await expect(
    palette.getByRole("option", { name: /P07 · Sentinel node AI evaluation/ }),
  ).toBeVisible();
  await palette.getByRole("combobox").fill("open my");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/my-work$/);
});

test("the account menu shows the person and switches the theme", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Lenka Malá");
  await expect(menu).toContainText("Consultant · breast, nodes");
  await menu.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await menu.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("View as in the account menu switches the persona through the as param", async ({ page }) => {
  await page.goto("/my-work");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Anna Kopecká" }).click();
  await expect(page).toHaveURL(/as=AK/);
  await expect(badge(page)).toContainText("viewing as Anna Kopecká");
  await expect(page.getByText("Decide 3 objects on RT-14")).toBeVisible();
  await page.goto("/team?as=DH");
  await expect(badge(page)).toContainText("viewing as Daniel Hruška");
});

test("only people with admin rights see Post and End on the announcements", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "Announcements" });
  await expect(card).toContainText("CellViT is now one of Parfocal's models");
  await expect(card.getByRole("button", { name: "Post" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /^End announcement/ })).toHaveCount(0);
});

test("an admin posts an announcement, sees it first with its end, and ends it", async ({
  page,
}) => {
  await page.goto("/?as=DH");
  const card = page.getByRole("region", { name: "Announcements" });
  await expect(card.getByRole("button", { name: /^End announcement/ })).toHaveCount(3);
  await card.getByRole("button", { name: "Post" }).click();
  const dialog = page.getByRole("dialog", { name: "Post an announcement" });
  await dialog.getByRole("button", { name: /^Post/ }).click();
  await expect(dialog).toContainText("Write what you want to tell people.");
  await dialog.getByRole("radio", { name: "Slowdown" }).click();
  await dialog.getByLabel("Text").fill("Lab server restarts at 16:00");
  await dialog.getByRole("radio", { name: "1 hour" }).click();
  await dialog.getByRole("button", { name: /^Post/ }).click();
  await expect(dialog).toBeHidden();
  await expect(
    card.getByRole("button", { name: /^End announcement/ }).first(),
  ).toHaveAccessibleName("End announcement: Lab server restarts at 16:00");
  await expect(card).toContainText("until 15:30");
  await expect(card.getByRole("button", { name: /^End announcement/ })).toHaveCount(4);
  await card
    .getByRole("button", { name: "End announcement: Lab server restarts at 16:00" })
    .click();
  await expect(card).not.toContainText("Lab server restarts at 16:00");
  await expect(card.getByRole("button", { name: /^End announcement/ })).toHaveCount(3);
});

test("To review continues into guided review at the next open object in one action", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/my-work?tab=review");
  const tasks = page.getByRole("listbox", { name: "Your tasks" });
  await expect(tasks).toContainText("Continue where you left off");
  await expect(tasks).toContainText("Sentinel node AI evaluation · Tumor regions: all · due");
  await expect(tasks.getByText("Blind").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/guided\?slide=[0-9a-f-]+&object=T5$/);
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible({
    timeout: 60_000,
  });
  await page.goBack();
  await page.getByRole("button", { name: /^Continue reviewing/ }).click();
  await expect(page).toHaveURL(/&object=T5$/);
  const url = new URL(page.url());
  url.searchParams.set("object", "T3");
  await page.goto(url.toString());
  await expect(page.getByText(/The AI says T3 is tumor/)).toBeVisible({ timeout: 60_000 });
});
