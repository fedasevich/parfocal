import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1280, height: 900 } });

const card = (page: Page) => page.getByTestId("study-task-card");
const step = (page: Page, index: number) =>
  expect(card(page)).toContainText(`${index}/10`, { timeout: 30_000 });

async function stageReady(task: Page) {
  await expect(task.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

const cellsReady = (task: Page) =>
  expect(task.getByTestId("cell-type-bar")).toBeVisible({ timeout: 30_000 });

const startTask = (page: Page) => page.getByRole("button", { name: "Start task" }).click();
const markDone = (page: Page) => page.getByRole("button", { name: "Done" }).click();

async function startSessionFor(page: Page, participant: string) {
  await page.getByLabel("Participant code").fill(participant);
  await page.getByRole("button", { name: "Start session" }).click();
}

async function stillOn(page: Page, index: number) {
  await page.waitForTimeout(3000);
  await expect(card(page)).toContainText(`${index}/10`);
}

test("the ten pilot tasks run end to end, three end by their checks and none fires for the next participant", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/study");
  await startSessionFor(page, "P1");

  const popup = page.waitForEvent("popup");
  await startTask(page);
  const task = await popup;
  await task.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await step(page, 2);

  await startTask(page);
  await stageReady(task);
  await task.keyboard.press("g");
  await task.keyboard.press("2");
  await step(page, 3);

  await startTask(page);
  await stageReady(task);
  await markDone(page);
  await step(page, 4);

  for (const index of [5, 6]) {
    await startTask(page);
    await cellsReady(task);
    await markDone(page);
    await step(page, index);
  }

  await startTask(page);
  await cellsReady(task);
  expect(
    await task.evaluate(() => document.body.innerText.match(/.{0,40}: disagree.{0,20}/g)),
  ).toBeNull();
  await task
    .getByTestId("cell-type-bar")
    .getByRole("button", { name: /Stroma/ })
    .click();
  await step(page, 7);

  await startTask(page);
  await cellsReady(task);
  await markDone(page);
  await step(page, 8);

  await startTask(page);
  await stageReady(task);
  await markDone(page);
  await step(page, 9);

  await startTask(page);
  await cellsReady(task);
  await markDone(page);
  await step(page, 10);

  await startTask(page);
  await expect(task).toHaveURL(/\/evaluation/);
  await expect(task.getByRole("main")).toBeVisible({ timeout: 30_000 });
  await markDone(page);
  await expect(page.getByTestId("study-session-finished")).toBeVisible();
  const log = page.getByRole("region", { name: "Results" }).getByRole("listitem");
  expect((await log.innerText()).match(/\(auto\)/g)?.length).toBe(3);

  await startSessionFor(page, "P2");
  await startTask(page);
  await expect(task.getByTestId("slide-row").first()).toBeVisible({ timeout: 30_000 });
  await stillOn(page, 1);
  await markDone(page);

  await startTask(page);
  await stageReady(task);
  await stillOn(page, 2);
  await markDone(page);

  for (const index of [3, 4, 5]) {
    await expect(card(page)).toContainText(`${index}/10`);
    await startTask(page);
    await markDone(page);
  }

  await startTask(page);
  await cellsReady(task);
  await stillOn(page, 6);
});

test("a moderator runs the ten tasks, then the round is frozen and the next round is editable", async ({
  page,
}) => {
  await page.goto("/study");
  await expect(page.getByTestId("study-round")).toHaveAttribute("data-frozen", "false");
  await expect(page.getByTestId("study-summary").locator("tbody tr")).toHaveCount(10);

  await page.getByLabel("Participant code").fill("P1");
  await page.getByRole("button", { name: "Start session" }).click();
  for (let index = 0; index < 10; index += 1) {
    await expect(page.getByTestId("study-task-card")).toBeVisible();
    await page.getByRole("button", { name: "Start task" }).click();
    await page.getByRole("button", { name: "Done" }).click();
  }
  await expect(page.getByTestId("study-session-finished")).toBeVisible();
  await expect(page.getByTestId("study-row-t1").getByRole("cell").nth(2)).toHaveText("1");
  await expect(page.getByTestId("study-row-t10").getByRole("cell").nth(2)).toHaveText("1");

  await expect(page.getByTestId("study-round")).toHaveAttribute("data-frozen", "true");
  await page.getByRole("button", { name: "Save tasks" }).click();
  await expect(page.getByTestId("study-error")).toContainText("frozen");

  await page.getByRole("button", { name: "Start next round" }).click();
  await expect(page.getByTestId("study-round")).toHaveAttribute("data-frozen", "false");
  await page
    .getByLabel("Task set JSON")
    .fill(JSON.stringify([{ id: "a", title: "Only task", instruction: "Do it" }]));
  await page.getByRole("button", { name: "Save tasks" }).click();
  await expect(page.getByTestId("study-summary").locator("tbody tr")).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId("study-summary").locator("tbody tr")).toHaveCount(1);
});
