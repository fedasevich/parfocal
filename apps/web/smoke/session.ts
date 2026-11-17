import { expect, type Page } from "@playwright/test";

export const email = process.env["PARFOCAL_SMOKE_EMAIL"] ?? "";
export const password = process.env["PARFOCAL_SMOKE_PASSWORD"] ?? "";

export const appSignIn = (page: Page) => page.getByRole("heading", { name: "Sign in to Parfocal" });
export const hostedLoginName = (page: Page) =>
  page.locator("input[name='loginName'], input#loginName, input[autocomplete='username']");

export async function readJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

export async function signIn(page: Page, origin: string) {
  await page.goto("/sign-in");
  await expect(appSignIn(page).or(hostedLoginName(page)).first()).toBeVisible();
  if (await appSignIn(page).isVisible()) {
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  } else {
    await hostedLoginName(page).fill(email);
    await page.locator("button[type='submit']").first().click();
    await page.locator("input[type='password']").fill(password);
    await page.locator("button[type='submit']").first().click();
  }
  const app = new URL(origin).origin;
  await page.waitForURL((url) => url.origin === app && !url.pathname.startsWith("/sign-in"));
}
