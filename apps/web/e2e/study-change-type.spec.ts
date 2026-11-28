import { round5Tasks } from "../src/study/study-model.ts";
import { expect, type Page, test } from "./a11y.ts";
import { presetRun } from "./study-round5-walk.ts";

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 30_000 });

const changeTypeIndex = round5Tasks.findIndex((task) => task.id === "change-type");
const instruction = round5Tasks[changeTypeIndex]?.instruction ?? "";

async function startChangeType(page: Page) {
  await presetRun(page, "P-FAKE");
  await page.goto("/study");
  await page.getByRole("button", { name: "I agree and start" }).click();
  await page.evaluate((index) => {
    const key = "parfocal.study.run";
    const run = JSON.parse(window.sessionStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    window.sessionStorage.setItem(key, JSON.stringify({ ...run, index }));
  }, changeTypeIndex);
  await page.reload();
  await expect(page.getByTestId("study-goal-big")).toHaveText(instruction, { timeout: 15_000 });
  const start = page.getByRole("button", { name: "Start task", exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.getByTestId("slide-stage").first()).toHaveAttribute("data-state", "ready", {
    timeout: 45_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Objects" }).click();
  const card = page.getByTestId("object-foot");
  const firstOpen = page.getByRole("button", { name: /, the first open object$/ });
  for (let step = 0; step < 6; step += 1) {
    await firstOpen.click();
    await expect(card).toHaveAttribute("data-object", /\S/);
    if (/(^|·)C\d+$/.test((await card.getAttribute("data-object")) ?? "")) break;
    await card.locator('button[data-counts-as="agree"]').click();
    await card.getByRole("button", { name: "Close" }).click();
  }
  await expect(page.getByTestId("cell-type-bar")).toBeVisible();
  await expect(page.getByTestId("study-review-head")).toHaveCount(0);
}

const complete = (page: Page) =>
  expect(page.getByTestId("study-review-head")).toHaveText("Task complete", { timeout: 15_000 });

test("choosing Immune in the type bar completes the change-type task", async ({ page }) => {
  await startChangeType(page);
  await page
    .getByTestId("cell-type-bar")
    .getByRole("button", { name: /Immune/ })
    .click();
  await complete(page);
});

test("pressing the Immune key completes the change-type task", async ({ page }) => {
  await startChangeType(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("3");
  await complete(page);
});

test("pressing the Immune key with the type bar hidden completes the change-type task", async ({
  page,
}) => {
  await startChangeType(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Shift+B");
  await expect(page.getByTestId("cell-type-hint")).toBeVisible();
  await page.keyboard.press("3");
  await complete(page);
});
