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
  await expect(body).toContainText("Are the drawn outlines acceptable for this slide?");
  await expect(body).not.toContainText("Is the AI result acceptable");

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
  await expect(page.getByTestId("outline-settle")).toContainText(
    "Draw a new outline if the drawn one is wrong.",
  );
  await expect(page.getByText("Draw a new outline if the AI's is wrong.")).toHaveCount(0);
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
  await expect(drawer).toContainText(
    "A redraw is compared with the drawn outline when the other reviewer kept it.",
  );
  await expect(drawer).not.toContainText("compared with the AI outline");
});

test("an AI review keeps its AI wording in the wizard form, outline settle and settings", async ({
  page,
}) => {
  await page.goto(`${newTask}?scene=check`);
  await expect(flow(page)).toContainText("Is the AI result acceptable for this slide?");
  await page.goto(`${rt14}/disagreements?stage=open`);
  await expect(page.getByTestId("outline-settle")).toContainText(
    "Draw a new outline if the AI's is wrong.",
  );
  await page.goto("/projects/00000000-0000-4000-8003-000000000007?tab=tasks");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "RT-13" })
    .getByRole("button", { name: "Settings for RT-13" })
    .click();
  await expect(page.getByRole("dialog", { name: "Settings for RT-13" })).toContainText(
    "A redraw is compared with the AI outline when the other reviewer kept it.",
  );
});

const a1 = "00000000-0000-4000-8005-000000000001";

for (const { source, sees, hidden } of [
  {
    source: "&source=drawn",
    sees: "Do the drawn outlines miss any tumor on this slide?",
    hidden: "Does the AI miss any tumor on this slide?",
  },
  {
    source: "",
    sees: "Does the AI miss any tumor on this slide?",
    hidden: "Do the drawn outlines miss any tumor on this slide?",
  },
]) {
  test(`a custom opinion form reads ${source ? "as drawn" : "as AI"} on the reviewer's screen`, async ({
    page,
  }) => {
    await page.goto(`${rt14}/guided?slide=${a1}&scene=required&form=custom${source}`);
    await expect(page.getByRole("radiogroup", { name: sees })).toBeVisible();
    await expect(page.getByText(hidden)).toHaveCount(0);
  });
}

const rt17 = "00000000-0000-4000-8007-000000000017";

test("the first read of a drawn review hides the drawn outlines, not the AI", async ({ page }) => {
  await page.goto(`/tasks/${rt17}/guided?slide=${a1}&source=drawn`);
  const panel = page.getByTestId("first-read-panel");
  await expect(panel).toContainText("Read the slide without the drawn outlines");
  await expect(panel).toContainText(
    "The drawn outlines are hidden until you record your first read.",
  );
  await expect(panel).not.toContainText(/\bAI\b/);
});

test("the display tab of a drawn review orders by drawing, not by the AI", async ({ page }) => {
  await page.goto(`${rt14}/guided?slide=${a1}&scene=display&source=drawn`);
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("button", { name: /What the layers show/ })).toBeVisible();
  await panel.getByRole("button", { name: /How the review moves/ }).click();
  await expect(panel.getByText("Drawing order · fit · moves on by itself")).toBeVisible();
  await expect(panel.getByText(/AI order/)).toHaveCount(0);
});

const p07 = "00000000-0000-4000-8003-000000000007";
const liveSlide = `/projects/${p07}/slides/${a1}?task=00000000-0000-4000-8007-000000000014`;

async function liveReady(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

test("the live viewer's Display tab reads as drawn from the task's drawn flag", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await liveReady(page, `${liveSlide}&source=drawn`);
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  const panel = page.getByTestId("stage-display");
  await expect(panel.getByText("What the layers show")).toBeVisible();
  await expect(panel.getByText("What the AI shows")).toHaveCount(0);
  await expect(panel).not.toContainText("AI order");
});

test("the live viewer names who drew the outlines and shows no scores", async ({ page }) => {
  test.setTimeout(90_000);
  await liveReady(page, `${liveSlide}&source=drawn`);
  const objects = page.getByTestId("stage-review-objects");
  await expect(objects.getByText("Drawn outlines")).toBeVisible();
  await expect(objects.getByText(/(by hand|with Smart select)/).first()).toBeVisible();
  await expect(objects.getByText("Result set", { exact: true })).toHaveCount(0);
  await expect(objects.getByText("0.00")).toHaveCount(0);
});

test("the live guided coach says a person drew the outline", async ({ page }) => {
  test.setTimeout(90_000);
  await liveReady(page, `${liveSlide}&mode=guided&source=drawn`);
  await expect(page.getByTestId("stage-coach")).toContainText(
    "A person drew this. It is outlined in white.",
  );
  await expect(page.getByText("The AI found this.")).toHaveCount(0);
});

test("the live viewer of an AI review still reads as AI", async ({ page }) => {
  test.setTimeout(90_000);
  await liveReady(page, liveSlide);
  const objects = page.getByTestId("stage-review-objects");
  await expect(objects.getByText("AI says")).toBeVisible();
  await expect(objects.getByText("Result set", { exact: true })).toBeVisible();
});

test("the guided card of a drawn outline names it as drawn", async ({ page }) => {
  await page.goto(`${rt14}/guided?slide=${a1}&scene=region&source=drawn`);
  await expect(
    page.getByRole("button", { name: "Add something the outlines missed" }),
  ).toBeVisible();
  await expect(page.getByText("Add something the AI missed")).toHaveCount(0);
});
