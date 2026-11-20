import { expect, test } from "./harness.ts";
import { call, idOf } from "./support.ts";

test("an annotate task is created from its stepper and opens", async ({ page, researcher }) => {
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);

  await page.goto(`/projects/${projectId}/tasks/new-annotate?step=slides`);
  const flow = page.getByTestId("new-annotate-task");
  await expect(flow.getByRole("checkbox").first()).toBeVisible();
  await expect(flow.locator("input[type=checkbox]:checked")).toHaveCount(0);
  await flow.getByRole("checkbox").first().check();

  await flow.getByRole("button", { name: "Next" }).click();
  await expect(flow).toHaveAttribute("data-step", "experts");
  await expect(flow.locator("input[type=checkbox]:checked")).toHaveCount(0);
  await flow.getByRole("checkbox").first().check();

  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await expect(flow).toHaveAttribute("data-step", "send");
  await expect(flow.getByRole("button", { name: "Send to experts" })).toBeDisabled();

  await flow.getByRole("textbox", { name: "Task name" }).fill("Annotate the sample");
  await flow.getByRole("button", { name: "Send to experts" }).click();
  await expect(flow.getByRole("status")).toContainText("Annotate the sample was sent");

  await flow.getByRole("button", { name: "Open the task" }).click();
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?task=[^&]+&mode=annotate/);
  const taskId = new URL(page.url()).searchParams.get("task") ?? "";
  const task = await call(page, "GET", `/api/review-tasks/${taskId}`);
  expect(task.status, JSON.stringify(task.json)).toBe(200);
  expect(task.json).toMatchObject({
    name: "Annotate the sample",
    kind: "annotate",
    reviewer_count: 1,
  });
  expect(researcher.me).not.toBe("");
});
