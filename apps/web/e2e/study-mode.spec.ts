import { expect, test } from "./a11y.ts";

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
