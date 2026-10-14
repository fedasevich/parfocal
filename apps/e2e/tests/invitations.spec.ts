import { existsSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { outbox, readSession, signIn, sql, username } from "./support.ts";

interface SentEmail {
  to: string;
  template: string;
  link: string;
}

function isSentEmail(value: unknown): value is SentEmail {
  return typeof value === "object" && value !== null && "to" in value && "link" in value;
}

function lastInvitationLink(): string {
  const lines = existsSync(outbox) ? readFileSync(outbox, "utf8").trim().split("\n") : [];
  const sent = lines.map((line): unknown => JSON.parse(line)).filter(isSentEmail);
  const mine = sent.filter((email) => email.to === username.toLowerCase());
  const last = mine.at(-1);
  if (last === undefined) {
    throw new Error("No invitation email reached the outbox");
  }
  return last.link;
}

function makeWorkspace(): string {
  const slug = `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const [id = ""] = sql(
    `WITH organisation AS (INSERT INTO organisations (slug, name) VALUES ('${slug}', 'E2E ${slug}') RETURNING id) ` +
      `INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) ` +
      `SELECT id, '${slug}', 'E2E ${slug}', 'diagnostic', 'eu', 'pilot' FROM organisation RETURNING id`,
  ).split("\n");
  return id;
}

async function call(
  page: Page,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    },
    { method, path, body },
  );
}

async function inviteAsOperator(page: Page, subject: string, tenantId: string): Promise<string> {
  sql(`INSERT INTO platform_operators (subject) VALUES ('${subject}') ON CONFLICT DO NOTHING`);
  try {
    const invited = await call(page, "POST", `/api/platform/tenants/${tenantId}/invitations`, {
      email: username,
      role: "lead",
    });
    expect(invited.status, JSON.stringify(invited.json)).toBe(201);
  } finally {
    sql(`DELETE FROM platform_operators WHERE subject = '${subject}'`);
  }
  const token = new URL(lastInvitationLink()).pathname.split("/").at(-1);
  if (token === undefined) {
    throw new Error("The invitation link has no token");
  }
  return token;
}

function actions(tenantId: string): string[] {
  return sql(
    `SELECT string_agg(action, ',' ORDER BY seq) FROM audit_events WHERE tenant_id = '${tenantId}'`,
  ).split(",");
}

test("an invited pathologist accepts and lands in the new workspace", async ({ page }) => {
  await signIn(page, "/cases/S26-0101");
  const { subject } = await readSession(page);
  const tenantId = makeWorkspace();
  const token = await inviteAsOperator(page, subject, tenantId);

  const accepted = await call(page, "POST", "/api/invitations/accept", { token });
  expect(accepted.status).toBe(200);
  expect(accepted.json).toMatchObject({ tenant_id: tenantId, role: "lead" });
  const current = await call(page, "GET", "/api/tenant", undefined);
  expect(current.json).toMatchObject({ id: tenantId });
  expect(actions(tenantId)).toEqual(["invitation.created", "invitation.accepted", "member.added"]);
  sql(`DELETE FROM memberships WHERE tenant_id = '${tenantId}'`);
});

test("an expired invitation is refused and the refusal is audited", async ({ page }) => {
  await signIn(page, "/cases/S26-0102");
  const { subject } = await readSession(page);
  const tenantId = makeWorkspace();
  const token = await inviteAsOperator(page, subject, tenantId);
  sql(
    `UPDATE invitations SET expires_at = now() - interval '1 second' WHERE tenant_id = '${tenantId}'`,
  );

  const refused = await call(page, "POST", "/api/invitations/accept", { token });
  expect(refused.status).toBe(410);
  expect(refused.json).toMatchObject({ code: "invitation-expired" });
  expect(actions(tenantId)).toEqual(["invitation.created", "invitation.expired"]);
});
