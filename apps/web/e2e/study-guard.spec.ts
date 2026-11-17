import { expect, test } from "./a11y.ts";

test.use({ viewport: { width: 1280, height: 900 } });

const slideList = "/projects/{project}?tab=slides";

const tasks = [
  {
    id: "a",
    title: "Stay on the list",
    instruction: "Look at the slide list.",
    slide: "tumor_044",
    startPath: slideList,
    guard: { stayOn: ["^/projects/{project}$"], where: "This task happens on the slide list." },
  },
  {
    id: "b",
    title: "Open the slide",
    instruction: "Open the slide.",
    slide: "tumor_044",
    startPath: slideList,
    guard: { stayOn: ["^/projects/{project}$"], where: "This task happens on the slide list." },
    check: { path: "/slides/{slide}/live" },
  },
  {
    id: "c",
    title: "Go anywhere",
    instruction: "Open the slide.",
    slide: "tumor_044",
    startPath: slideList,
  },
];

test("a guard blocks a wrong destination with its message, lets the completing one pass and leaves unguarded tasks alone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/study");
  await page.getByLabel("Task set JSON").fill(JSON.stringify(tasks));
  await page.getByRole("button", { name: "Save tasks" }).click();
  await page.getByLabel("Participant code").fill("P1");
  await page.getByRole("button", { name: "Start session" }).click();

  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Start task" }).click();
  const task = await popup;
  const row = task.getByTestId("slide-row").filter({ hasText: "tumor_044" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  const listUrl = task.url();
  await row.click();
  await expect(task.getByTestId("study-guard-message")).toHaveText(
    "This task happens on the slide list.",
  );
  expect(task.url()).toBe(listUrl);
  await expect(page.getByTestId("study-row-a").getByRole("cell").nth(4)).toHaveText("1", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("study-block-log")).toContainText("a to /projects/");
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByTestId("study-task-card")).toContainText("2/3");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("study-task-card")).toContainText("3/3", { timeout: 15_000 });
  await expect(task).toHaveURL(/\/slides\/.+\/live/);
  await expect(task.getByTestId("study-guard-message")).toHaveCount(0);
  await expect(page.getByTestId("study-row-b").getByRole("cell").nth(4)).toHaveText("0");

  await page.getByRole("button", { name: "Start task" }).click();
  await expect(task.getByTestId("slide-row").first()).toBeVisible({ timeout: 30_000 });
  await task.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(task).toHaveURL(/\/slides\/.+\/live/);
  await expect(task.getByTestId("study-guard-message")).toHaveCount(0);
  await expect(page.getByTestId("study-row-c").getByRole("cell").nth(4)).toHaveText("0");
});
