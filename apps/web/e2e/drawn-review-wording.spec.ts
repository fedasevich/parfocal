import { expect, type Locator, type Page, test } from "./a11y.ts";

const newTask = "/projects/00000000-0000-4000-8003-000000000007/tasks/new";
const rt14 = "/tasks/00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1280, height: 900 } });

const flow = (page: Page) => page.getByTestId("new-task");
const projectName = "Sentinel node AI evaluation";
const stepText = async (body: Locator) =>
  ((await body.textContent()) ?? "").replaceAll(projectName, "");
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

  await body.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("dialog", { name: "Preview the question" });
  await expect(preview).toContainText("How sure are you that T2⁺ is tumor?");
  await expect(preview).toContainText("Drawn as: Tumor");
  await expect(preview).not.toContainText(/\bAI\b/);
  await preview.getByRole("button", { name: /^Done/ }).click();
  await expect(preview).toBeHidden();

  await body.getByRole("button", { name: "Next" }).click();
  await expect(step).toHaveText(/How it runs/);
  await body.getByRole("switch", { name: /Hide the drawn outlines for a first read/ }).click();
  await expect(body).toContainText("Hide the drawn outlines for a first read");
  await expect(body).toContainText("These questions show the drawn type.");
  expect(await stepText(body)).not.toMatch(/\bAI\b/);

  await body.getByRole("button", { name: "Next" }).click();
  await expect(step).toHaveText(/Send/);
  await expect(body).toContainText("first read without the drawn outlines");
  expect(await stepText(body)).not.toMatch(/\bAI\b/);
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
  await expect(panel.getByTestId("queue-mapping")).toContainText(/^Agree keeps the outline \S+/);
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

test("the queue of a drawn review filters by the drawer, not the AI", async ({ page }) => {
  await page.goto(`${rt14}/disagreements?stage=open&source=drawn`);
  await expect(page.getByRole("radio", { name: /^(Reviewer|Both) vs drawer \d+$/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /vs AI/ })).toHaveCount(0);
});

test("the adjudicator of a drawn review reads about the drawn outline", async ({ page }) => {
  await page.goto(`${rt14}/adjudicate?stage=sent&source=drawn`);
  await expect(page.getByText(/the drawn outline/).first()).toBeVisible();
  await expect(page.getByText(/with the AI|The AI says/)).toHaveCount(0);
  await expect(page.getByText(/% sure/)).toHaveCount(0);
});

test("the evaluation report of a drawn review prints no model scores", async ({ page }) => {
  await page.goto(`${rt14}/evaluation?scene=report&source=drawn`);
  await expect(
    page.getByText("This task reviews drawn outlines, so no AI result is scored.").first(),
  ).toBeVisible();
  await expect(page.getByText(/^(Sensitivity|Precision|Dice)/)).toHaveCount(0);
  await expect(page.getByText("Cells agreed")).toHaveCount(0);
});

test("the task settings of a drawn review count answers against the drawn outline", async ({
  page,
}) => {
  await page.goto("/projects/00000000-0000-4000-8003-000000000007?tab=tasks&source=drawn");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "RT-13" })
    .getByRole("button", { name: "Settings for RT-13" })
    .click();
  const drawer = page.getByRole("dialog", { name: "Settings for RT-13" });
  await expect(drawer).toContainText("as agree with the drawn outline");
  await expect(drawer).not.toContainText("agree with the AI");
});
