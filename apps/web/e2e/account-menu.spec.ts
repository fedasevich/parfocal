import { expect, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const commentsTab = `/tasks/${rt14}/comments?slide=${a1}&thread=T2`;

test("log out ends the session and a comment draft is still there after logging back in", async ({
  page,
}) => {
  const logOuts: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/logout") logOuts.push(request.url());
  });
  await page.goto(commentsTab);
  const composer = page
    .getByRole("region", { name: "Thread on T2" })
    .getByRole("textbox", { name: "Comment on T2" });
  await expect(composer).toBeEditable({ timeout: 20_000 });
  await composer.fill("The margin looks closer than 1 mm");

  await page.getByRole("button", { name: "Account menu" }).click();
  const logOut = page.getByRole("menuitem", { name: "Log out" });
  await expect(page.getByRole("menu")).not.toContainText(/sign out/i);
  await logOut.click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(logOuts).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();

  await page.goto(commentsTab);
  await expect(composer).toHaveValue("The margin looks closer than 1 mm", { timeout: 20_000 });
});

test("the status dropdown lists each status with its meaning and picks away and back", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^Available/ }).click();
  const available = page.getByRole("menuitemradio", { name: /^Available/ });
  const away = page.getByRole("menuitemradio", { name: /^Away/ });
  await expect(available).toContainText("Researchers can give you review tasks");
  await expect(away).toContainText("tasks can be reassigned");
  await expect(available).toHaveAttribute("aria-checked", "true");
  await expect(away).toHaveAttribute("aria-checked", "false");
  await away.click();
  await expect(page.getByRole("menuitem", { name: /^Away/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /^Away/ }).click();
  await expect(page.getByRole("menuitemradio", { name: /^Away/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemradio", { name: /^Available/ }).click();
  await expect(page.getByRole("menuitem", { name: /^Available/ })).toBeVisible();
});

test("picking busy from the status dropdown turns the avatar dot busy", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^Available/ }).click();
  const busy = page.getByRole("menuitemradio", { name: /^Busy/ });
  await expect(busy).toContainText("not taking new review tasks");
  await busy.click();
  await expect(page.getByRole("menuitem", { name: /^Busy/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Account menu" }).getByLabel("Busy")).toBeVisible();
});

test("initials only hides the full name in the menu at once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Initials only/ }).click();
  await expect(page.getByTestId("account-name")).toHaveText("LM");
  await expect(page.getByRole("group", { name: "Signed in as" })).not.toContainText("Lenka Malá");
});
