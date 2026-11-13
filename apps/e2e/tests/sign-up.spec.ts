import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  deleteZitadelUser,
  emailCode,
  forgetEmails,
  readSession,
  zitadelUserExists,
  zitadelUserIds,
} from "./support.ts";

test("a new account is created, confirmed by the emailed code and removed again", async ({
  page,
}) => {
  const email = `e2e-sign-up-${randomBytes(4).toString("hex")}@parfocal.test`;
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).hostname));
  try {
    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill("Sign Up Tester");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("a local sign-up passphrase");
    await page.getByRole("radio", { name: /Run evaluations/ }).click();
    await page.getByRole("checkbox", { name: /I agree to the terms/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    const code = page.getByLabel("Confirmation code");
    await expect(code).toBeAttached();
    await code.fill(await emailCode(email));
    await page.getByRole("button", { name: /confirm/i }).click();

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/setup");
    const session = await readSession(page);
    expect(session.email?.toLowerCase()).toBe(email);
  } finally {
    const created = await zitadelUserIds(email);
    for (const userId of created) {
      expect(await deleteZitadelUser(userId)).toBe(200);
      await expect.poll(() => zitadelUserExists(userId)).toBe(false);
    }
    await forgetEmails(email);
    expect(created).toHaveLength(1);
  }
  expect([...hosts].filter((host) => host.endsWith("zitadel.cloud"))).toEqual([]);
});
