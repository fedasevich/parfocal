import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
process.loadEnvFile(`${root}.zitadel/e2e.env`);

const origin = `http://localhost:${process.env["PARFOCAL_WEB_PORT"] ?? "5173"}`;
const username = String(process.env["ZITADEL_TEST_USERNAME"]);
const password = readFileSync(`${root}.zitadel/test-password`, "utf8").trim();

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ baseURL: origin });
  await page.goto("/sign-in?return_to=/");
  await page.getByLabel("Work email").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
  await page.getByText("Start something", { exact: true }).waitFor({ timeout: 60_000 });
  if (await page.getByLabel("No workspace yet").isVisible()) {
    throw new Error("The home screen shows no workspace, so the seed did not reach the test user");
  }
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session");
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  if (session.status !== 200) {
    throw new Error(`The session endpoint answered ${session.status}`);
  }
  const heading = await page.getByRole("heading", { level: 1 }).first().textContent();
  console.log(
    `Signed in as ${String(session.body["email"])} on ${page.url()}, heading "${heading}"`,
  );
} finally {
  await browser.close();
}
