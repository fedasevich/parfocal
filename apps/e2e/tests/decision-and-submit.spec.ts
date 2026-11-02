import { expect, type Page, test } from "@playwright/test";
import { readSession, signIn, sql } from "./support.ts";

interface Reply {
  status: number;
  json: unknown;
}

async function call(page: Page, method: string, path: string, body?: unknown): Promise<Reply> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(
        path,
        body === undefined
          ? { method }
          : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const text = await response.text();
      return { status: response.status, json: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body },
  );
}

function field(reply: Reply, name: string): string {
  const { json } = reply;
  if (typeof json === "object" && json !== null && name in json) {
    const value: unknown = Reflect.get(json, name);
    if (typeof value === "string") return value;
  }
  throw new Error(`No ${name} in ${JSON.stringify(json)}`);
}

const idOf = (reply: Reply) => field(reply, "id");

function researcherWorkspace(userId: string): string {
  const slug = `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return (
    sql(
      `WITH organisation AS (INSERT INTO organisations (slug, name) VALUES ('${slug}', 'E2E ${slug}') RETURNING id), ` +
        `tenant AS (INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) ` +
        `SELECT id, '${slug}', 'E2E ${slug}', 'research', 'eu', 'pilot' FROM organisation RETURNING id) ` +
        `INSERT INTO memberships (tenant_id, user_id, role) SELECT id, '${userId}', 'researcher' FROM tenant ` +
        `RETURNING tenant_id`,
    ).split("\n")[0] ?? ""
  );
}

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
