import { expect, test } from "./a11y.ts";
import { addVirtualAuthenticator } from "./virtual-authenticator.ts";

const password = "correct-horse-staple";
const email = "lenka@fnvltava.example";

test("after a password sign-in the browser saves a passkey and lands", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  await page.goto("/sign-in?return_to=%2Fprojects");
  await expect(page.getByLabel("Work email")).toHaveAttribute("autocomplete", "username webauthn");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in without a password next time" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save a passkey" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const [saved] = await authenticator.credentials();
  expect(saved?.rpId).toBe("localhost");
});

test("a saved passkey signs in from the sign-in page", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  await authenticator.saveCredential();
  await page.goto("/sign-in?return_to=%2Fprojects");
  await page.getByLabel("Work email").fill(email);
  const finished = page.waitForRequest((request) =>
    request.url().endsWith("/api/auth/passkey-sign-in/finish"),
  );
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  const body = (await finished).postDataJSON() as { credential: { id: string } };
  expect(body.credential.id).toBe(Buffer.from("e2e-passkey").toString("base64url"));
  await expect(page).toHaveURL(/\/projects$/);
  const [used] = await authenticator.credentials();
  expect(used?.signCount).toBeGreaterThan(0);
});

test("a cancelled passkey window leaves the sign-in page usable", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  await authenticator.saveCredential();
  await authenticator.refuseUserVerification();
  await page.goto("/sign-in?return_to=%2Fprojects");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeEnabled();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("settings add a passkey to the keychain", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  await page.goto("/settings/privacy");
  const add = page.getByRole("button", { name: "Add a passkey" });
  await add.click();
  await expect(page.getByText("Passkey saved.", { exact: false })).toBeVisible();
  expect(await authenticator.credentials()).toHaveLength(1);
});
