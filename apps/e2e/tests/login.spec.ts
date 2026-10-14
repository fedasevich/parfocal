import { expect, test } from "@playwright/test";
import { readSession, sessionStatus, signIn, sql, username } from "./support.ts";

function tokensDigest(subject: string): string {
  return sql(
    `SELECT md5(string_agg(encode(tokens, 'hex'), '')) FROM sessions WHERE subject = '${subject}'`,
  );
}

test("login returns to the deep link the user started from", async ({ page }) => {
  await signIn(page, "/cases/S26-0001?slide=2");
  expect(new URL(page.url()).search).toBe("?slide=2");
  const session = await readSession(page);
  expect(session).toMatchObject({ email: username, operator: false });
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__Host-parfocal_session");
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
  expect(await page.evaluate("document.cookie")).not.toContain("parfocal_session");
});

test("an expired access token is refreshed on the server without the page noticing", async ({
  page,
}) => {
  await signIn(page, "/cases/S26-0002");
  const { subject } = await readSession(page);
  sql(
    `UPDATE sessions SET access_expires_at = now() - interval '1 minute' WHERE subject = '${subject}'`,
  );
  const before = tokensDigest(subject);
  expect(await sessionStatus(page)).toBe(200);
  const refreshedFor = sql(
    `SELECT count(*) FROM sessions WHERE subject = '${subject}' AND access_expires_at > now() + interval '1 hour'`,
  );
  expect(Number(refreshedFor)).toBeGreaterThan(0);
  expect(tokensDigest(subject)).not.toBe(before);
  await page.reload();
  expect(await sessionStatus(page)).toBe(200);
});

test("logout ends the session here and at Zitadel", async ({ page }) => {
  await signIn(page, "/cases/S26-0003");
  await page.goto("/api/auth/logout");
  await page.waitForURL("http://localhost:5173/");
  expect(await sessionStatus(page)).toBe(401);
  await page.goto("/api/auth/login?return_to=/cases/S26-0003");
  await page.getByRole("button", { name: username }).click();
  await expect(page.locator("input[type=password]")).toBeVisible();
  expect(new URL(page.url()).hostname).toContain("zitadel.cloud");
});
