import type { Page } from "@playwright/test";
import { expect, test } from "./harness.ts";
import { adjudicatorUsername, call, field, idOf, signIn, sql } from "./support.ts";

test.skip(adjudicatorUsername === "", "The local stack has no adjudicator test user");

interface Question {
  key: string;
  kind: string;
  max?: number;
  options?: string[];
}

function fitting(question: Question): unknown {
  if (question.kind === "scale") return question.max;
  if (question.kind === "choice") return question.options?.[0];
  if (question.kind === "yesno") return true;
  return "Fine";
}

async function submitSlide(page: Page, slide: string): Promise<void> {
  const refused = await call(page, "POST", `${slide}/submit`);
  expect(refused.status, JSON.stringify(refused.json)).toBe(409);
  const left = Reflect.get(refused.json ?? {}, "current") as {
    open_objects: string[];
    unanswered_questions: string[];
  };
  for (const object of left.open_objects) {
    const more = await call(page, "PUT", `${slide}/decisions/${object}`, { answer: "5" });
    expect(more.status, JSON.stringify(more.json)).toBe(200);
  }
  const opinion = await call(page, "GET", `${slide}/opinion`);
  const questions = Reflect.get(opinion.json ?? {}, "questions") as Question[];
  const answers = Object.fromEntries(
    questions
      .filter((question) => left.unanswered_questions.includes(question.key))
      .map((question) => [question.key, fitting(question)]),
  );
  const answered = await call(page, "PUT", `${slide}/opinion`, { answers });
  expect(answered.status, JSON.stringify(answered.json)).toBe(200);
  const submitted = await call(page, "POST", `${slide}/submit`);
  expect(submitted.status, JSON.stringify(submitted.json)).toBe(200);
}

test("a disagreement goes to an adjudicator who decides it on the drawn slide", async ({
  page,
  browser,
  researcher,
}) => {
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);
  const [taskId = "", slideId = ""] = sql(
    `SELECT t.id || '|' || s.id FROM review_tasks t JOIN slides s ON s.project_id = t.project_id ` +
      `WHERE t.project_id = '${projectId}' AND s.label = 'test_065'`,
  ).split("|");
  const slide = `/api/review-tasks/${taskId}/slides/${slideId}`;
  const task = `/api/review-tasks/${taskId}`;

  const disagreed = await call(page, "PUT", `${slide}/decisions/T1`, {
    answer: "1",
    note: "The edge looks off",
  });
  expect(disagreed.status, JSON.stringify(disagreed.json)).toBe(200);
  expect(disagreed.json).toMatchObject({ object: "T1", value: "disagree" });
  await submitSlide(page, slide);

  const queue = await call(page, "GET", `${task}/disagreements`);
  expect(queue.status, JSON.stringify(queue.json)).toBe(200);
  expect(JSON.stringify(queue.json)).toContain('"T1"');

  const context = await browser.newContext();
  const adjudicator = await context.newPage();
  try {
    await signIn(adjudicator, "/setup", adjudicatorUsername);
    const profile = await call(adjudicator, "GET", "/api/me");
    const adjudicatorId = field(profile, "user_id");
    sql(
      `INSERT INTO memberships (tenant_id, user_id, role) ` +
        `VALUES ('${researcher.tenantId}', '${adjudicatorId}', 'researcher')`,
    );
    sql(
      `INSERT INTO project_members (tenant_id, project_id, user_id, role) ` +
        `VALUES ('${researcher.tenantId}', '${projectId}', '${adjudicatorId}', 'reviewer')`,
    );
    const switched = await call(adjudicator, "PUT", "/api/me/workspace", {
      tenant_id: researcher.tenantId,
    });
    expect(switched.status, JSON.stringify(switched.json)).toBe(200);

    const sent = await call(page, "POST", `${task}/disagreements/adjudications`, {
      adjudicator_user_id: adjudicatorId,
      objects: [{ slide_id: slideId, object: "T1" }],
      note: "Please look at the edge",
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);

    await adjudicator.goto(`/tasks/${taskId}/adjudicate`);
    await expect(adjudicator.getByTestId("still-engine").locator("canvas").first()).toBeVisible({
      timeout: 30_000,
    });
    await adjudicator.getByLabel("Note for the record").fill("Boundary is clearly off");
    await adjudicator
      .getByRole("group", { name: "Your decision on T1" })
      .getByRole("button")
      .first()
      .click();

    await expect
      .poll(async () => {
        const mine = await call(adjudicator, "GET", `/api/adjudications/objects?task_id=${taskId}`);
        return JSON.stringify(mine.json);
      })
      .toContain("Boundary is clearly off");
  } finally {
    await context.close();
  }

  const listed = await call(page, "GET", `${task}/disagreements/adjudications`);
  expect(listed.status, JSON.stringify(listed.json)).toBe(200);
  expect(listed.json).toMatchObject([
    { object: "T1", decision: { value: "disagree", note: "Boundary is clearly off" } },
  ]);

  await page.goto(`/tasks/${taskId}/evaluation`);
  await expect(page.getByRole("list", { name: "Adjudications" })).toContainText("T1");
  await page.goto(`/tasks/${taskId}/sign-off`);
  await expect(page.getByRole("list", { name: "Adjudications" })).toContainText("T1");
});
