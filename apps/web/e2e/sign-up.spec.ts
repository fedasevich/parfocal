import { expect, type Page, test } from "@playwright/test";

const password = "a-fresh-long-passphrase";
const code = "481726";
const newEmail = "jana@clinic.example";

const fillAccount = async (page: Page, overrides: { email?: string; password?: string } = {}) => {
  await page.getByRole("textbox", { name: "Full name" }).fill("Jana Nováková");
  await page.getByRole("textbox", { name: "Work email" }).fill(overrides.email ?? newEmail);
  await page.getByLabel("Password", { exact: true }).fill(overrides.password ?? password);
};

const typeCode = (page: Page, digits: string) =>
  page.getByRole("textbox", { name: "Confirmation code" }).fill(digits);

test("a new person signs up, confirms the email with the code and reaches setup", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await fillAccount(page);
  await page.getByRole("radio", { name: /Run evaluations/ }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
  await expect(page.getByText(newEmail)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and set up" })).toBeDisabled();
  await typeCode(page, "000000");
  await page.getByRole("button", { name: "Confirm and set up" }).click();
  await expect(page.getByRole("alert")).toContainText("That code is wrong or has expired");
  await typeCode(page, code);
  await page.getByRole("button", { name: "Confirm and set up" }).click();
  await expect(page).toHaveURL(/\/setup\?step=role$/);
});

test("problems with the details are named before and after the request", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter your name");
  await fillAccount(page, { password: "short" });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 12 characters");
  await page.getByLabel("Password", { exact: true }).fill("password1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("This password is in known leaks");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("Agree to the terms");
});

test("an email that already has an account says so", async ({ page }) => {
  await page.goto("/sign-up");
  await fillAccount(page, { email: "lenka@fnvltava.example" });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("already has an account");
  await expect(page).toHaveURL(/\/sign-up/);
});

test("changing the address goes back with the details kept, and the new address gets the code", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await fillAccount(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: /Resend in 0:4\d/ })).toBeVisible();
  await page.getByRole("button", { name: "Change it" }).click();
  await expect(page.getByRole("textbox", { name: "Work email" })).toHaveValue(newEmail);
  await page.getByRole("textbox", { name: "Work email" }).fill("jana@other.example");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("jana@other.example")).toBeVisible();
});

test("single sign-on skips the code and opens setup", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: /Sign up with .* single sign-on/ }).click();
  await expect(page).toHaveURL(/\/setup\?step=role$/);
});

test("a direct visit to the confirm step can ask for a new code", async ({ page }) => {
  await page.goto("/sign-up?scene=verify");
  await page.getByRole("button", { name: "Resend the code" }).click();
  await expect(page.getByText("A new code is on its way")).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend in/ })).toBeVisible();
});
