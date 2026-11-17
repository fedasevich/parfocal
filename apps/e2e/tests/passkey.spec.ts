import type { Page } from "@playwright/test";
import { expect, test } from "./harness.ts";
import {
  apiLogs,
  call,
  idOf,
  readSession,
  sql,
  username,
  zitadelAdmin,
  zitadelIssuer,
} from "./support.ts";

interface ZitadelUser {
  userId: string;
  details: { resourceOwner: string };
}

async function testUser(): Promise<ZitadelUser> {
  const response = await zitadelAdmin("/v2/users", {
    method: "POST",
    body: JSON.stringify({ queries: [{ emailQuery: { emailAddress: username } }] }),
  });
  const found = (await response.json()) as { result?: ZitadelUser[] };
  const user = found.result?.[0];
  if (user === undefined) throw new Error("The local Zitadel has no test user");
  return user;
}

async function passkeyIds(userId: string): Promise<string[]> {
  const response = await zitadelAdmin(`/v2/users/${userId}/passkeys/_search`, {
    method: "POST",
    body: "{}",
  });
  const found = (await response.json()) as { result?: { id: string; state: string }[] };
  return (found.result ?? [])
    .filter((passkey) => passkey.state === "AUTH_FACTOR_STATE_READY")
    .map((passkey) => passkey.id);
}

async function forgetPasskeys(userId: string): Promise<void> {
  for (const id of await passkeyIds(userId)) {
    await zitadelAdmin(`/v2/users/${userId}/passkeys/${id}`, { method: "DELETE" });
  }
}

async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    verifies: async (answer: boolean) => {
      await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: answer });
    },
  };
}

async function enrolPasskey(page: Page, user: ZitadelUser): Promise<void> {
  await forgetPasskeys(user.userId);
  const response = await zitadelAdmin(`/v2/users/${user.userId}/passkeys/registration_link`, {
    method: "POST",
    body: JSON.stringify({ returnCode: {} }),
  });
  const { code } = (await response.json()) as { code: { id: string; code: string } };
  const query = new URLSearchParams({
    userID: user.userId,
    orgID: user.details.resourceOwner,
    codeID: code.id,
    code: code.code,
  });
  await page.goto(`${zitadelIssuer}/ui/login/login/passwordless/init?${query.toString()}`);
  await page.locator("input[name=name]").fill("E2E passkey");
  await page.locator("#btn-register").click();
  await expect.poll(async () => (await passkeyIds(user.userId)).length).toBe(1);
}

async function answerWithPasskey(page: Page): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${zitadelIssuer}/ui/login/`));
  await page.locator("#btn-login").click();
}

test("a passkey signs in and unlocks a locked slide to the same camera position", async ({
  page,
  researcher,
}) => {
  const user = await testUser();
  await addAuthenticator(page);
  try {
    const sample = await call(page, "POST", "/api/projects/sample");
    expect(sample.status, JSON.stringify(sample.json)).toBe(201);
    const projectId = idOf(sample);
    const slideId = sql(
      `SELECT id FROM slides WHERE project_id = '${projectId}' AND tenant_id = '${researcher.tenantId}' ORDER BY label LIMIT 1`,
    );
    const slidePath = `/projects/${projectId}/slides/${slideId}`;
    await enrolPasskey(page, user);

    await page.goto("/api/auth/logout");
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/sign-in");
    await page.goto(`/sign-in?return_to=${encodeURIComponent(`${slidePath}?x=0.3&y=0.4&z=2`)}`);
    await page.getByLabel("Work email").fill(username);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    const profile = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/me" && response.ok(),
    );
    await answerWithPasskey(page);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(slidePath);
    expect((await readSession(page)).email).toBe(username);
    await profile;

    await page.evaluate('window.dispatchEvent(new Event("lock-screen"))');
    const lock = page.getByRole("region", { name: "Locked" });
    await expect(lock).toBeVisible();
    const lockedAt = page.url();
    expect(new URL(lockedAt).searchParams.get("z")).not.toBeNull();
    const login = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().includes("/api/auth/login"),
    );
    await lock.getByRole("button", { name: "Unlock with a passkey" }).click();
    const started = await login;
    expect(started.postDataJSON()).toMatchObject({ login_hint: username, reauth: true });
    expect(started.url()).not.toContain(username);
    expect(started.url()).not.toContain(encodeURIComponent(username));
    await answerWithPasskey(page);
    await expect(page).toHaveURL(lockedAt, { timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Locked" })).toBeHidden();
    const logs = apiLogs();
    expect(logs).toContain("/api/auth/login");
    expect(logs).not.toContain(username);
    expect(logs).not.toContain(encodeURIComponent(username));
  } finally {
    await forgetPasskeys(user.userId);
  }
});

test("a cancelled passkey window leaves the sign-in page usable", async ({ page }) => {
  const user = await testUser();
  const authenticator = await addAuthenticator(page);
  try {
    await enrolPasskey(page, user);
    await page.goto("/sign-in?return_to=%2F");
    await page.getByLabel("Work email").fill(username);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await authenticator.verifies(false);
    await answerWithPasskey(page);
    await expect(page.getByText(/timed out or was not allowed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Login with password" })).toBeVisible();

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/sign-in");
    const email = page.getByLabel("Work email");
    await expect(email).toBeEditable();
    await email.fill(username);
    await authenticator.verifies(true);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await answerWithPasskey(page);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/");
    expect((await readSession(page)).email).toBe(username);
  } finally {
    await forgetPasskeys(user.userId);
  }
});
