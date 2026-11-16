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

test("the ten pilot tasks run end to end on their start screens and the checks end six of them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/study");
  await page.getByLabel("Participant code").fill("P1");
  await page.getByRole("button", { name: "Start session" }).click();

  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Start task" }).click();
  const task = await popup;
  await task.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await step(page, 2);

  await page.getByRole("button", { name: "Start task" }).click();
  await stageReady(task);
  await task.keyboard.press("]");
  await step(page, 3);

  await page.getByRole("button", { name: "Start task" }).click();
  await stageReady(task);
  await page.getByRole("button", { name: "Done" }).click();
  await step(page, 4);

  await page.getByRole("button", { name: "Start task" }).click();
  await stageReady(task);
  await task.keyboard.press("g");
  await task.keyboard.press("3");
  await expect(task.getByTestId("area-nav")).toHaveAttribute("data-current", "T3");
  await step(page, 5);

  await page.getByRole("button", { name: "Start task" }).click();
  await expect(task.getByTestId("cell-type-bar")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await step(page, 6);

  await page.getByRole("button", { name: "Start task" }).click();
  await expect(task.getByTestId("cell-type-bar")).toBeVisible({ timeout: 30_000 });
  expect(
    await task.evaluate(() => document.body.innerText.match(/.{0,40}: disagree.{0,20}/g)),
  ).toBeNull();
  await task
    .getByTestId("cell-type-bar")
    .getByRole("button", { name: /Immune/ })
    .click();
  await step(page, 7);

  await page.getByRole("button", { name: "Start task" }).click();
  await stageReady(task);
  const box = await task.getByTestId("slide-stage").boundingBox();
  if (box === null) throw new Error("The slide stage has no box");
  await task.keyboard.press("l");
  await task.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await task.mouse.down();
  await task.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await task.mouse.up();
  await step(page, 8);

  await page.getByRole("button", { name: "Start task" }).click();
  await stageReady(task);
  await task.keyboard.press("Alt+5");
  await task.getByTestId("view-map-ask").click();
  await step(page, 9);

  for (const index of [10, 11]) {
    await page.getByRole("button", { name: "Start task" }).click();
    await stageReady(task);
    await page.getByRole("button", { name: "Done" }).click();
    if (index === 10) await step(page, 10);
  }
  await expect(page.getByTestId("study-session-finished")).toBeVisible();
  const log = page.getByRole("region", { name: "Results" }).getByRole("listitem");
  await expect(log).toContainText("t1 ");
  expect((await log.innerText()).match(/\(auto\)/g)?.length).toBe(6);
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
