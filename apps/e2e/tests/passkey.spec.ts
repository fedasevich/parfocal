import type { Page } from "@playwright/test";
import { expect, test } from "./harness.ts";
import { apiLogs, call, idOf, readSession, sql, username, zitadelAdmin } from "./support.ts";

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
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey saved.", { exact: false })).toBeVisible();
  await expect.poll(async () => (await passkeyIds(user.userId)).length).toBe(1);
}

async function signOut(page: Page): Promise<void> {
  await page.goto("/api/auth/logout");
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/sign-in");
}

function originsVisited(page: Page): Set<string> {
  const origins = new Set<string>();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) origins.add(new URL(frame.url()).origin);
  });
  return origins;
}

const passkeyRequest = (page: Page, path: string) =>
  page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === path,
  );

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

    await signOut(page);
    const origins = originsVisited(page);
    await page.goto(`/sign-in?return_to=${encodeURIComponent(`${slidePath}?x=0.3&y=0.4&z=2`)}`);
    await page.getByLabel("Work email").fill(username);
    const started = passkeyRequest(page, "/api/auth/passkey-sign-in");
    const profile = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/me" && response.ok(),
    );
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    const start = await started;
    expect(start.postDataJSON()).toEqual({ email: username });
    expect(start.url()).not.toContain(encodeURIComponent(username));
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(slidePath);
    expect((await readSession(page)).email).toBe(username);
    await profile;

    const lock = page.getByRole("region", { name: "Locked" });
    await expect(async () => {
      await page.evaluate('window.dispatchEvent(new Event("lock-screen"))');
      await expect(lock).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    const lockedAt = page.url();
    expect(new URL(lockedAt).searchParams.get("z")).not.toBeNull();
    const unlocked = passkeyRequest(page, "/api/auth/passkey-sign-in/finish");
    await lock.getByRole("button", { name: "Unlock with a passkey" }).click();
    const finish = await unlocked;
    const lockedPath = new URL(lockedAt);
    expect(finish.postDataJSON()).toMatchObject({
      return_to: `${lockedPath.pathname}${lockedPath.search}`,
    });
    await expect(page).toHaveURL(lockedAt, { timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Locked" })).toBeHidden();
    expect([...origins]).toEqual([new URL(page.url()).origin]);
    const logs = apiLogs();
    expect(logs).toContain("/api/auth/passkey-sign-in");
    expect(logs).not.toContain(username);
    expect(logs).not.toContain(encodeURIComponent(username));
  } finally {
    await forgetPasskeys(user.userId);
  }
});

test("a cancelled passkey window leaves the sign-in page usable", async ({
  page,
  researcher: _signedIn,
}) => {
  const user = await testUser();
  const authenticator = await addAuthenticator(page);
  try {
    await enrolPasskey(page, user);
    await signOut(page);
    const origins = originsVisited(page);
    await page.goto("/sign-in?return_to=%2F");
    const email = page.getByLabel("Work email");
    await email.fill(username);
    await authenticator.verifies(false);
    const passkey = page.getByRole("button", { name: "Sign in with a passkey" });
    const finished = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/auth/passkey-sign-in/finish",
      { timeout: 5_000 },
    );
    await passkey.click();
    await expect(finished).rejects.toThrow();
    expect(new URL(page.url()).pathname).toBe("/sign-in");
    await expect(email).toBeEditable();
    await expect(passkey).toBeEnabled();

    await email.fill(username);
    await authenticator.verifies(true);
    await passkey.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/");
    expect((await readSession(page)).email).toBe(username);
    expect([...origins]).toEqual([new URL(page.url()).origin]);
  } finally {
    await forgetPasskeys(user.userId);
  }
});
