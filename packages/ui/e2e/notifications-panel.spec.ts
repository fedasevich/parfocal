import { expect, type Page, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-overlays--${name}&viewMode=story&globals=a11y.manual:!true`;

const rows = (page: Page) => page.getByTestId("notification");

test("each tab shows its unread count and filters the list", async ({ page }) => {
  await page.goto(story("notifications-unread"));
  await expect(page.getByRole("radio", { name: "For me 2" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Mentions 1" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Jobs 1" })).toBeVisible();
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole("radio", { name: "Mentions 1" }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Lenka Malá mentioned you");
  await page.getByRole("radio", { name: "Jobs 1" }).click();
  await expect(rows(page)).toHaveCount(2);
});

test("unread only hides what was seen and says so when nothing is left", async ({ page }) => {
  await page.goto(story("notifications-interactive"));
  await page.getByRole("switch", { name: "Unread only" }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("radio", { name: "Jobs 1" }).click();
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().getByRole("button", { name: "Review the results" }).click();
  await expect(page.getByText("Nothing unread here")).toBeVisible();
});

test("opening one item marks it read and lowers its counts", async ({ page }) => {
  await page.goto(story("notifications-interactive"));
  await expect(rows(page).first().getByRole("img", { name: "Unread" })).toBeVisible();
  await rows(page).first().getByRole("button", { name: "Open the comment" }).click();
  await expect(page.getByTestId("opened")).toHaveText("n1");
  await expect(rows(page).first().getByRole("img", { name: "Unread" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "For me 1" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Mentions" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Jobs 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark all read" })).toBeVisible();
});

test("mark all read clears every count and swaps the link for All read", async ({ page }) => {
  await page.goto(story("notifications-interactive"));
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByText("All read")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "For me", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Jobs", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Unread" })).toHaveCount(0);
});

test("see all is a button that asks to leave the panel", async ({ page }) => {
  await page.goto(story("notifications-interactive"));
  await page.getByRole("button", { name: "See all" }).click();
  await expect(page.getByTestId("see-all")).toHaveText("pressed");
});
