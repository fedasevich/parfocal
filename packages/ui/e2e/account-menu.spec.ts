import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const open = "components-overlays--account-menu-open";

test("the menu shows the name, role and workspace", async ({ page }) => {
  await page.goto(story(open));
  const signedIn = page.getByRole("group", { name: "Signed in as" });
  await expect(signedIn).toContainText("Lenka Malá");
  await expect(signedIn).toContainText("Consultant · breast, nodes");
  await expect(signedIn).toContainText("Institute of Pathology");
});

test("the status row switches availability and keeps the menu open", async ({ page }) => {
  await page.goto(story(open));
  await page.getByRole("menuitem", { name: /Available/ }).click();
  await expect(page.getByRole("menuitem", { name: /Away/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Away/ }).click();
  await expect(page.getByRole("menuitem", { name: /Available/ })).toBeVisible();
});

test("the status row waits while the change is saving", async ({ page }) => {
  await page.goto(story("components-overlays--account-menu-saving"));
  await expect(page.getByRole("menuitem", { name: /Available/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("theme and initials only apply at once", async ({ page }) => {
  await page.goto(story(open));
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).not.toBeChecked();
  const initials = page.getByRole("menuitemcheckbox", { name: /Initials only/ });
  await initials.click();
  await expect(initials).toBeChecked();
  await expect(page.getByTestId("account-name")).toHaveText("LM");
  await initials.click();
  await expect(page.getByTestId("account-name")).toHaveText("Lenka Malá");
});

for (const item of ["Settings", "Keyboard shortcuts", "Profile and signature", "Log out"]) {
  test(`${item} runs its action and closes the menu`, async ({ page }) => {
    await page.goto(story(open));
    await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.getByRole("status", { name: "Last chosen" })).toHaveText(item);
  });
}

test("help waits until it is written and log out never reads like signing out a case", async ({
  page,
}) => {
  await page.goto(story(open));
  await expect(page.getByRole("menuitem", { name: /Help and what's new/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.getByRole("menu")).not.toContainText(/sign out|sign-out|signing out/i);
});

test("keyboard users reach every item in order", async ({ page }) => {
  await page.goto(story(open));
  await page.getByRole("menuitem", { name: /Available/ }).focus();
  const reached: string[] = [];
  for (let step = 0; step < 12; step += 1) {
    const name = await page.evaluate(() => {
      const active = document.activeElement;
      return (active?.getAttribute("aria-label") ?? active?.textContent ?? "").trim();
    });
    reached.push(name);
    await page.keyboard.press("ArrowDown");
  }
  const labels = [
    "Available",
    "Dark",
    "Initials only",
    "Settings",
    "Keyboard shortcuts",
    "Profile and signature",
    "Help and what's new",
    "Log out",
  ];
  const order = labels.map((label) => reached.findIndex((name) => name.includes(label)));
  for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
  expect(order).toEqual([...order].sort((left, right) => left - right));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
});
