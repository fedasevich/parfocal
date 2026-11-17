import { expect, test } from "./a11y.ts";
import { addVirtualAuthenticator } from "./virtual-authenticator.ts";

const email = "lenka@fnvltava.example";
const code = "481726";
const newPassword = "a-fresh-long-passphrase";

test("a forgotten password is reset with the emailed code and signs in", async ({ page }) => {
  await page.goto("/sign-in?return_to=%2Fprojects");
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Set password and sign in" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Reset code" }).fill("000000");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("That code is wrong or has expired");
  await page.getByRole("textbox", { name: "Reset code" }).fill(code);
  await page.getByLabel("New password", { exact: true }).fill("password1234");
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("This password is in known leaks");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("the emailed link opens the reset screen with the code filled in", async ({ page }) => {
  await page.goto(`/sign-in?scene=reset&user_id=3141592&code=${code}&return_to=%2Fprojects`);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reset code" })).toHaveValue(code);
  await expect(page.getByRole("button", { name: "Set password and sign in" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Reset code" }).fill("gp0ryg");
  await expect(page.getByRole("textbox", { name: "Reset code" })).toHaveValue("GP0RYG");
  await page.getByRole("textbox", { name: "Reset code" }).fill(code);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("settings remove a saved passkey", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey saved.", { exact: false })).toBeVisible();
  expect(await authenticator.credentials()).toHaveLength(1);
  await page.getByRole("button", { name: /^Remove the passkey/ }).click();
  await expect(page.getByText("Passkey removed.", { exact: false })).toBeVisible();
  await expect(page.getByText("None saved")).toBeVisible();
});
