import { expect, type Page, test } from "./a11y.ts";

const newTask = "/projects/00000000-0000-4000-8003-000000000007/tasks/new";
const rt14 = "/tasks/00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1280, height: 900 } });

const flow = (page: Page) => page.getByTestId("new-task");
const aiWording = /The AI's claim|agree with the AI|Agree with the AI|vs AI|the AI's call/;

test("the wizard names a review of drawn outlines after them and asks about the outline", async ({
  page,
}) => {
  await page.goto(`${newTask}?scene=slides`);
  const body = flow(page);
  const name = body.getByRole("textbox", { name: "Task name" });
  await expect(name).toHaveValue(/^Review of /);
  await body.getByRole("radio", { name: /^Drawn and Smart select outlines/ }).click();
  await expect(name).toHaveValue("Review of drawn outlines");
  await expect(body.getByRole("radiogroup", { name: "Objects to check" })).toBeVisible();
  const step = body.locator('[aria-current="step"]');
  while (!/What to check/.test((await step.textContent()) ?? "")) {
    await body.getByRole("button", { name: "Next" }).click();
  }
  const question = body.getByRole("radiogroup", { name: "Decision question" });
  await expect(question).toContainText("The drawn outline and its type, then how sure");
  await expect(question).toContainText("agree with the drawn outline");
  await expect(question).not.toContainText(aiWording);
});

test("a typed task name stays when the source switches to drawn outlines", async ({ page }) => {
  await page.goto(`${newTask}?scene=slides`);
  const body = flow(page);
  const name = body.getByRole("textbox", { name: "Task name" });
  await name.fill("Round 3 outlines");
  await body.getByRole("radio", { name: /^Drawn and Smart select outlines/ }).click();
  await expect(name).toHaveValue("Round 3 outlines");
});

test("the queue's Decide panel names who drew the outline and with which tool", async ({
  page,
}) => {
  await page.goto(`${rt14}/disagreements?stage=open&source=drawn`);
  const panel = page.getByRole("complementary", { name: "Decide" });
  await expect(panel).toBeVisible();
  await expect(page.getByText(/^Drawn by .+ (by hand|with Smart select)$/).first()).toBeVisible();
  await expect(page.getByText(/% sure$/)).toHaveCount(0);
  await expect(panel).not.toContainText(aiWording);
  const mapping = panel.getByTestId("queue-mapping");
  if (await mapping.count()) await expect(mapping).toContainText("Agree keeps the outline");
});

test("the sign-off of a drawn review shows no model scores", async ({ page }) => {
  await page.goto(`${rt14}/sign-off?scene=ready&source=drawn`);
  const modal = page.getByRole("dialog", { name: "Sign off RT-14" });
  const metrics = modal.getByTestId("sign-off-metrics");
  await expect(metrics).toContainText("Cohen's κ, reviewers");
  await expect(metrics).not.toContainText(/Sensitivity|Precision|Dice|Cells agreed/);
});

test("the sign-off of an AI review still shows its model scores", async ({ page }) => {
  await page.goto(`${rt14}/sign-off?scene=ready`);
  const metrics = page
    .getByRole("dialog", { name: "Sign off RT-14" })
    .getByTestId("sign-off-metrics");
  await expect(metrics).toContainText("Sensitivity, regions");
  await expect(metrics).toContainText("Dice, regions");
});
