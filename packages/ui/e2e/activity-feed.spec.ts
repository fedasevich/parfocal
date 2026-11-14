import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-activity-feed--${name}&viewMode=story&globals=a11y.manual:!true`;

test("everything lists every seeded event with its unread marks", async ({ page }) => {
  await page.goto(story("seeded"));
  await expect(page.getByTestId("activity-row")).toHaveCount(5);
  await expect(page.getByRole("img", { name: "Unread" })).toHaveCount(2);
  await expect(page.getByRole("radio", { name: "Everything" })).toBeChecked();
});

test("mentions keeps mentions and replies only", async ({ page }) => {
  await page.goto(story("seeded"));
  await page.getByRole("radio", { name: "Mentions" }).click();
  await expect(page.getByTestId("activity-row")).toHaveCount(2);
  await expect(page.getByTestId("activity-row").first()).toContainText("Lenka Malá mentioned you");
  await expect(page.getByRole("img", { name: "Unread" })).toHaveCount(1);
});

test("jobs keeps model runs and imports only", async ({ page }) => {
  await page.goto(story("seeded"));
  await page.getByRole("radio", { name: "Jobs" }).click();
  await expect(page.getByTestId("activity-row")).toHaveCount(2);
  await expect(page.getByTestId("activity-row").first()).toContainText("PathoSAM finished");
});

test("a row opens its event", async ({ page }) => {
  await page.goto(story("seeded"));
  await page.getByTestId("activity-row").nth(1).click();
  await expect(page.getByTestId("opened")).toHaveText("a2");
});

test("an empty feed says so", async ({ page }) => {
  await page.goto(story("empty"));
  await expect(page.getByTestId("activity-empty")).toHaveText("Nothing here yet");
  await expect(page.getByTestId("activity-row")).toHaveCount(0);
});

test("the feed renders in dark and light", async ({ page }) => {
  await page.goto(story("dark-and-light"));
  await expect(page.locator('[data-theme="dark"] [data-testid="activity-row"]')).toHaveCount(5);
  await expect(page.locator('[data-theme="light"] [data-testid="activity-row"]')).toHaveCount(5);
});
