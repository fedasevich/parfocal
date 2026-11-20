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
export const adjudicatorUsername = process.env["ZITADEL_ADJUDICATOR_USERNAME"] ?? "";

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

export function inApiContainer(module: string, args: string[], input?: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "infra/local/stack.compose.yaml",
      "exec",
      "-T",
      "server",
      "python",
      "-m",
      module,
      ...args,
    ],
    { cwd: root, encoding: "utf8", ...(input === undefined ? {} : { input }) },
  ).trim();
}

export function apiLogs(): string {
  return execFileSync(
    "docker",
    ["compose", "-f", "compose.yaml", "-f", "infra/local/stack.compose.yaml", "logs", "server"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

export async function signIn(
  page: Page,
  deepLink: string,
  email: string = username,
): Promise<void> {
  await page.goto(`/sign-in?return_to=${encodeURIComponent(deepLink)}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  const later = page.getByRole("button", { name: "Not now", exact: true });
  const throttled = page.getByText("Too many requests, try again shortly");
  await expect
    .poll(
      async () => {
        if (await throttled.isVisible()) {
          await page.waitForTimeout(5_000);
          await submit.click();
        }
        return (await later.isVisible()) || new URL(page.url()).pathname !== "/sign-in";
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  if (await later.isVisible()) await later.click();
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

export function zitadelAdmin(path: string, init: RequestInit = {}): Promise<Response> {
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
