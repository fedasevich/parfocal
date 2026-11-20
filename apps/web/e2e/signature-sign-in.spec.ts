import type { Page, Request } from "@playwright/test";
import { expect, test } from "./telemetry-capture.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";
const report = `/projects/${p03}/cases/${sentinelCase}/report`;
const coSign = `/projects/${p03}/cases/${sentinelCase}/co-sign`;
const rt14 = "00000000-0000-4000-8007-000000000014";
const password = "correct-horse-staple";

test.setTimeout(120_000);

const flow = (page: Page) => page.getByTestId("clinical-report");
const step = (page: Page) => flow(page).locator('[aria-current="step"]');

async function next(page: Page, to: RegExp) {
  await flow(page).getByRole("button", { name: "Next" }).click();
  await expect(step(page)).toHaveText(to);
}

async function toSignStep(page: Page, path: string) {
  await page.goto(path);
  await expect(step(page)).toHaveText(/Findings/);
  await next(page, /Staging/);
  await flow(page)
    .getByRole("radio", { name: /Macrometastasis/ })
    .click();
  await flow(page).getByRole("radio", { name: "Absent" }).click();
  await next(page, /Report text/);
  await next(page, /Sign out/);
}

const isReauth = (request: Request) =>
  request.url().endsWith("/api/auth/login") &&
  request.method() === "POST" &&
  (request.postDataJSON() as { reauth?: boolean } | null)?.reauth === true;

const refusedSignature = (page: Page) =>
  page.waitForResponse(
    (response) => response.status() === 403 && response.request().method() === "POST",
  );

async function signsAfterTheSignInStep(page: Page, click: () => Promise<void>) {
  const refused = refusedSignature(page);
  const reauth = page.waitForRequest(isReauth);
  await click();
  expect(await (await refused).json()).toMatchObject({ code: "fresh-sign-in-needed" });
  const login = (await reauth).postDataJSON() as { return_to: string; login_hint: string };
  expect(login.login_hint).toMatch(/@/);
  expect(new URL(page.url()).pathname).toBe(new URL(login.return_to, page.url()).pathname);
}

test("a task sign-off asks for the sign-in step before it signs", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/sign-off?scene=ready`);
  const sign = page.getByRole("button", { name: /^Sign with single sign-on/ });
  await signsAfterTheSignInStep(page, () => sign.click());
  await expect(page.getByText(/Evaluation v\d+ is signed\. Reviewers are told\./)).toBeVisible();
});

test("a sign out asks for the sign-in step before it signs", async ({ page }) => {
  await toSignStep(page, report);
  await flow(page).getByRole("button", { name: "Sign out", exact: true }).click();
  const sign = page.getByRole("dialog", { name: "Sign out S26-04812" });
  await signsAfterTheSignInStep(page, () =>
    sign.getByRole("button", { name: /Sign with single sign-on/ }).click(),
  );
  await expect(flow(page).getByText(/Signed out .* by Lenka Malá/)).toBeVisible();
});

test("a co-sign asks for the sign-in step before it signs", async ({ page }) => {
  await toSignStep(page, `${report}?as=TB`);
  await flow(page).getByPlaceholder("Type a name").click();
  await page.getByRole("option", { name: /Lenka Malá/ }).click();
  await flow(page).getByRole("button", { name: "Send for co-sign" }).click();
  await expect(flow(page).getByText(/Sent to Lenka Malá, .* · waiting/)).toBeVisible();

  await page.goto(coSign);
  await page.getByTestId("co-sign").getByRole("button", { name: "Co-sign and sign out" }).click();
  const sign = page.getByRole("dialog", { name: "Co-sign and sign out S26-04812" });
  await signsAfterTheSignInStep(page, () =>
    sign.getByRole("button", { name: /Sign with single sign-on/ }).click(),
  );
  await expect(
    page.getByText("Co-signed and signed out. The report names you both."),
  ).toBeVisible();
});

test("the password fallback checks the password before it signs", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/sign-off?scene=ssofail`);
  await page.getByRole("button", { name: "Use my password instead" }).click();
  await page.getByLabel(/Password for/).fill("not the password");
  await page.getByRole("button", { name: /^Sign with password/ }).click();
  await expect(page.getByText("That password did not work. Nothing was signed.")).toBeVisible();
  await page.getByLabel(/Password for/).fill(password);
  await page.getByRole("button", { name: /^Sign with password/ }).click();
  await expect(page.getByText(/Evaluation v\d+ is signed\. Reviewers are told\./)).toBeVisible();
});
