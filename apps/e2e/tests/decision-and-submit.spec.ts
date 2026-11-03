import { expect, test } from "@playwright/test";
import { call, field, idOf, readSession, researcherWorkspace, signIn, sql } from "./support.ts";

test("a reviewer decides on an AI region, submits, and the slide shows as submitted", async ({
  page,
}) => {
  await signIn(page, "/");
  const profile = await call(page, "GET", "/api/me");
  const me = field(profile, "user_id");
  const home = Reflect.get(profile.json ?? {}, "active_tenant_id") as unknown;
  const { subject } = await readSession(page);
  const tenantId = researcherWorkspace(me);
  const switched = await call(page, "PUT", "/api/me/workspace", { tenant_id: tenantId });
  expect(switched.status, JSON.stringify(switched.json)).toBe(200);
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);
  const [taskId = "", slideId = ""] = sql(
    `SELECT t.id || '|' || s.id FROM review_tasks t JOIN slides s ON s.project_id = t.project_id ` +
      `WHERE t.project_id = '${projectId}' AND s.label = 'tumor_001'`,
  ).split("|");
  const slide = `/api/review-tasks/${taskId}/slides/${slideId}`;

  const decided = await call(page, "PUT", `${slide}/verdicts/T1`, { answer: "5" });
  expect(decided.status, JSON.stringify(decided.json)).toBe(200);
  expect(decided.json).toMatchObject({ object: "T1", answer: "5", value: "agree" });

  const submitted = await call(page, "POST", `${slide}/submit`);
  expect(submitted.status, JSON.stringify(submitted.json)).toBe(200);

  const [reviewer = "", recent = ""] = sql(
    `SELECT user_id || '|' || (submitted_at > now() - interval '1 minute') FROM review_assignments ` +
      `WHERE task_id = '${taskId}' AND slide_id = '${slideId}'`,
  ).split("|");
  expect(reviewer).toBe(me);
  expect(recent).toBe("true");
  expect(
    sql(
      `SELECT p.subject || '|' || (e.details::jsonb ->> 'slide_id') FROM audit_events e ` +
        `JOIN audit_people p ON p.id = e.actor_id ` +
        `WHERE e.target_id = '${taskId}' AND e.action = 'task.review-submitted'`,
    ),
  ).toBe(`${subject}|${slideId}`);

  await page.goto(`/projects/${projectId}?tab=slides`);
  await expect(page.getByRole("row", { name: /tumor_001/ })).toContainText("submitted");
  await expect(page.getByRole("row", { name: /tumor_002/ })).toContainText("assigned");
  if (typeof home === "string") {
    await call(page, "PUT", "/api/me/workspace", { tenant_id: home });
  }
});
