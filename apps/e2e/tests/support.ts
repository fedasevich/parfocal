import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export const root = fileURLToPath(new URL("../../..", import.meta.url));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in .env to run the login tests`);
  }
  return value;
}

export const username = required("ZITADEL_TEST_USERNAME");
export const password = required("ZITADEL_TEST_PASSWORD");
export const outbox = required("EMAIL_OUTBOX");

export function sql(statement: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "parfocal",
      "-d",
      "parfocal",
      "-tAc",
      statement,
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
}

export async function signIn(page: Page, deepLink: string): Promise<void> {
  await page.goto(`/sign-in?return_to=${encodeURIComponent(deepLink)}`);
  await page.getByLabel("Work email").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe(deepLink.split("?")[0]);
}

export const zitadelIssuer = required("ZITADEL_ISSUER").replace(/\/$/, "");
const mailpit = process.env["MAILPIT_URL"] ?? "http://localhost:8025";

interface MailpitSearch {
  messages: { ID: string }[];
}

export async function emailCode(to: string): Promise<string> {
  let code = "";
  await expect(async () => {
    const search = (await (
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    ).json()) as MailpitSearch;
    const latest = search.messages[0];
    expect(latest).toBeDefined();
    const message = (await (await fetch(`${mailpit}/api/v1/message/${latest?.ID}`)).json()) as {
      Text: string;
    };
    code = /Code (\d{6})\)/.exec(message.Text)?.[1] ?? "";
    expect(code).toHaveLength(6);
  }).toPass({ timeout: 30_000 });
  return code;
}

function zitadelAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${zitadelIssuer}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${required("ZITADEL_ADMIN_TOKEN")}`,
      "content-type": "application/json",
    },
  });
}

export async function zitadelUserIds(email: string): Promise<string[]> {
  const response = await zitadelAdmin("/v2/users", {
    method: "POST",
    body: JSON.stringify({
      queries: [
        { emailQuery: { emailAddress: email, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } },
      ],
    }),
  });
  const found = (await response.json()) as { result?: { userId: string }[] };
  return (found.result ?? []).map((user) => user.userId);
}

export async function zitadelUserExists(userId: string): Promise<boolean> {
  return (await zitadelAdmin(`/v2/users/${userId}`)).status !== 404;
}

export async function deleteZitadelUser(userId: string): Promise<number> {
  return (await zitadelAdmin(`/v2/users/${userId}`, { method: "DELETE" })).status;
}

export async function forgetEmails(to: string): Promise<void> {
  await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`, {
    method: "DELETE",
  });
}

export interface SessionBody {
  subject: string;
  email: string | null;
  operator: boolean;
}

export async function sessionStatus(page: Page): Promise<number> {
  return page.evaluate(async () => (await fetch("/api/auth/session")).status);
}

function isSessionBody(value: unknown): value is SessionBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "subject" in value &&
    typeof value.subject === "string"
  );
}

export async function readSession(page: Page): Promise<SessionBody> {
  const body: unknown = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  if (!isSessionBody(body)) {
    throw new Error("The session endpoint did not return a session");
  }
  return body;
}

export interface Reply {
  status: number;
  json: unknown;
}

export async function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
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

export function field(reply: Reply, name: string): string {
  const { json } = reply;
  if (typeof json === "object" && json !== null && name in json) {
    const value: unknown = Reflect.get(json, name);
    if (typeof value === "string") return value;
  }
  throw new Error(`No ${name} in ${JSON.stringify(json)}`);
}

export const idOf = (reply: Reply) => field(reply, "id");

export function researcherWorkspace(userId: string): string {
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
