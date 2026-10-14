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
