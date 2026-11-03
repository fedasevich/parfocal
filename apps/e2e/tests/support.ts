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
  await page.goto(`/api/auth/login?return_to=${encodeURIComponent(deepLink)}`);
  await page.getByRole("textbox").first().fill(username);
  await page.keyboard.press("Enter");
  await page.locator("input[type=password]").fill(password);
  await page.keyboard.press("Enter");
  const skip = page.getByRole("button", { name: /skip/i });
  await expect(async () => {
    if (await skip.isVisible()) {
      await skip.click();
    }
    expect(new URL(page.url()).pathname).toBe(deepLink.split("?")[0]);
  }).toPass({ timeout: 30_000 });
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
