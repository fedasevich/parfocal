import { expect, test } from "@playwright/test";

const story =
  "/iframe.html?id=components-feedback-and-surfaces--undo-window&viewMode=story&globals=a11y.manual:!true";

test("Undo inside the window puts the decision back exactly as it was", async ({ page }) => {
  await page.clock.install();
  await page.goto(story);
  await page.getByRole("button", { name: "Agree", exact: true }).click();
  await expect(page.getByTestId("decision")).toHaveText("T1 is agree");
  await expect(page.getByRole("status")).toContainText("T1 marked agree");
  await page.clock.fastForward(2500);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("decision")).toHaveText("T1 is open");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("after 4 seconds the toast and its Undo are gone and the decision stays", async ({ page }) => {
  await page.clock.install();
  await page.goto(story);
  await page.getByRole("button", { name: "Agree", exact: true }).click();
  await page.clock.fastForward(4100);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByTestId("decision")).toHaveText("T1 is agree");
});

test("a second decision replaces the toast and Undo only reverses the latest one", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(story);
  await page.getByRole("button", { name: "Agree", exact: true }).click();
  await page.getByRole("button", { name: "Disagree", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("T1 marked disagree");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("decision")).toHaveText("T1 is agree");
});

test("the toast sits at the bottom edge, clear of the middle of the page", async ({ page }) => {
  await page.goto(story);
  await page.getByRole("button", { name: "Agree", exact: true }).click();
  const box = await page.getByRole("status").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box && viewport) expect(box.y + box.height).toBeGreaterThan(viewport.height * 0.9);
});
