import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-viewer-notices--${name}&viewMode=story&globals=a11y.manual:!true`;

test("saving and saved are a quiet word that no live region announces", async ({ page }) => {
  await page.goto(story("saved"));
  const word = page.getByTestId("save-status");
  await expect(word).toHaveText("All edits saved");
  await expect(word).not.toHaveAttribute("role");
  await expect(word).not.toHaveAttribute("aria-live");
  await expect(page.getByTestId("notice-alert")).toHaveText("");
  await expect(page.getByTestId("notice-status")).toHaveText("");
  await expect(page.getByRole("group")).toHaveCount(0);
});

test("a short blip is only the word and a long one is the banner with Try now", async ({
  page,
}) => {
  await page.goto(story("short-blip"));
  await expect(page.getByTestId("save-status")).toHaveText("Not connected, 1 edit waiting to save");
  await expect(page.getByTestId("offline-notice")).toHaveCount(0);
  await page.goto(story("long-offline"));
  await expect(page.getByTestId("offline-notice")).toContainText(
    "Not connected, 2 edits waiting to save",
  );
  await expect(page.getByTestId("notice-alert")).toContainText("save when the connection returns");
  await expect(page.getByRole("button", { name: "Try now" })).toBeVisible();
});

test("a colleague's changes are announced politely and never as an alert", async ({ page }) => {
  await page.goto(story("colleague-changes"));
  await expect(page.getByTestId("notice-status")).toHaveText("Anna Kovářová added 2, changed 1");
  await expect(page.getByTestId("notice-alert")).toHaveText("");
  await expect(page.getByRole("button", { name: "Show changes" })).toBeVisible();
});

test("a conflict is shown alone and names what waits behind it", async ({ page }) => {
  await page.goto(story("conflict-with-others-waiting"));
  await expect(page.getByTestId("conflict-notice")).toBeVisible();
  await expect(page.getByTestId("changes-by")).toHaveCount(0);
  await expect(page.getByTestId("not-saved-notice")).toHaveCount(0);
  await expect(page.getByTestId("notice-waiting")).toHaveText(
    "Shown next: edits that were not saved, a colleague's new changes.",
  );
  await expect(page.getByTestId("conflict-notice")).toContainText(
    "1 more conflict follows this one.",
  );
  await expect(page.getByTestId("save-status")).toHaveText("Some edits were not saved");
  await expect(page.getByTestId("notice-alert")).toContainText("Choose Keep mine or Keep theirs");
});

test("the keyboard resolves two conflicts one at a time and a second Enter never hits the next", async ({
  page,
}) => {
  await page.goto(story("interactive"));
  const log = page.locator("output");
  const trigger = page.getByRole("button", { name: "Two conflicts" });
  await page.getByRole("button", { name: "Colleague saves" }).click();
  await trigger.click();
  await expect(trigger).toBeFocused();
  const notice = page.getByRole("group", { name: "A colleague changed the shape you changed" });
  await expect(notice).toBeVisible();
  await expect(page.getByTestId("changes-by")).toHaveCount(0);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Keep mine" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Keep theirs" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(log).toHaveText("theirs 1");

  const second = page.getByRole("group", { name: "A colleague deleted the shape you changed" });
  await expect(second).toBeVisible();
  await expect(second.getByText("A colleague deleted the shape you changed")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(log).toHaveText("theirs 1");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Keep mine" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(log).toHaveText("theirs 1, mine 2");

  await expect(page.getByTestId("conflict-notice")).toHaveCount(0);
  await expect(page.getByTestId("changes-by")).toBeVisible();
  await page.getByRole("button", { name: "Show changes" }).click();
  await expect(page.getByTestId("changes-by")).toHaveCount(0);
});

test("edits not saved stay until Dismiss", async ({ page }) => {
  await page.goto(story("interactive"));
  await page.getByRole("button", { name: "Server refuses" }).click();
  await expect(page.getByTestId("not-saved-notice")).toContainText("Some edits were not saved.");
  await expect(page.getByTestId("notice-alert")).toContainText("a reload shows the last saved");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("not-saved-notice")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toHaveText("All edits saved");
});
