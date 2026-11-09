import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const cards = (page: Page) => page.locator('[data-slot="thread-card"]');

test("the tab opens on the open threads with both counts on the toggle", async ({ page }) => {
  await page.goto(story("components-comments-tab--open-threads"));
  await expect(page.getByRole("radio", { name: "Open 3" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Resolved 1" })).not.toBeChecked();
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first()).toContainText("Does the boundary run past the capsule fold?");
  await expect(cards(page).first()).toContainText("3");
});

test("the toggle swaps the list between open and resolved threads", async ({ page }) => {
  await page.goto(story("components-comments-tab--open-threads"));
  await page.getByRole("radio", { name: "Resolved 1" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("T4");
  await expect(cards(page).first()).toContainText("Resolved");
  await page.getByRole("radio", { name: "Open 3" }).click();
  await expect(cards(page)).toHaveCount(3);
});

test("a card selects its thread and Go to moves to its location", async ({ page }) => {
  await page.goto(story("components-comments-tab--open-threads"));
  const second = cards(page).nth(1);
  await expect(cards(page).first()).toHaveAttribute("data-selected", "true");
  await second.getByRole("button", { name: /Histiocyte/ }).click();
  await expect(second).toHaveAttribute("data-selected", "true");
  await expect(cards(page).first()).not.toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("went")).toHaveText("Nowhere yet");
  await second.getByRole("button", { name: "Go to T1·C145" }).click();
  await expect(page.getByTestId("went")).toHaveText("Went to T1·C145");
});

test("New comment asks for a comment", async ({ page }) => {
  await page.goto(story("components-comments-tab--open-threads"));
  await page.getByRole("button", { name: /New comment/ }).click();
  await expect(page.getByTestId("created")).toHaveText("1 new comment requests");
});

test("an empty filter says where the other threads are", async ({ page }) => {
  await page.goto(story("components-comments-tab--only-resolved"));
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="threads-empty"]')).toContainText("No open threads");
  await page.getByRole("radio", { name: "Resolved 4" }).click();
  await expect(cards(page)).toHaveCount(4);
});

test("a slide with no threads says so under both filters", async ({ page }) => {
  await page.goto(story("components-comments-tab--no-threads"));
  await expect(page.locator('[data-slot="threads-empty"]')).toHaveText(
    "No comments on this slide yet.",
  );
  await page.getByRole("radio", { name: "Resolved 0" }).click();
  await expect(page.locator('[data-slot="threads-empty"]')).toHaveText("No resolved threads yet.");
});

test("each thread says whether it lives on the slide or on a task", async ({ page }) => {
  await page.goto(story("components-comments-tab--slide-and-task-threads"));
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0).locator('[data-slot="thread-scope"]')).toHaveText(
    "RT-14 Margin review",
  );
  await expect(cards(page).nth(1).locator('[data-slot="thread-scope"]')).toHaveText("Slide");
  await expect(cards(page).nth(1)).toContainText("Is this the fold we saw last week?");
});
