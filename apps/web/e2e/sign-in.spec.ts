import { expect, type Page, test } from "@playwright/test";

const password = "correct-horse-staple";
const code = "481726";
const outsideEmail = "reviewer@clinic.example";
const slideUrl = /\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?task=[0-9a-f-]+/;

const defaultTarget = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-in-options");
    const body = (await response.json()) as { deep_link: { path: string } };
    return body.deep_link.path;
  });

const typeEmail = (page: Page, email: string) =>
  page.getByRole("textbox", { name: "Work email" }).fill(email);

test("a password signs in and lands on the deep link, a wrong one says so", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("After you sign in:")).toContainText("RT-14");
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The email or password is wrong");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page).toHaveURL(slideUrl);
});

test("single sign-on comes first when the email domain matches and moves down when it does not", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const sso = page.getByRole("button", { name: "Continue with FN Vltava single sign-on" });
  await expect(sso).toBeVisible();
  await expect(page.getByRole("button", { name: "Use single sign-on instead" })).toHaveCount(0);
  await typeEmail(page, outsideEmail);
  await expect(sso).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use single sign-on instead" })).toBeVisible();
  await typeEmail(page, "lenka@FNVltava.example");
  await sso.click();
  await expect(page).toHaveURL(slideUrl);
});

test("an email outside every institution picks one by hand and goes through single sign-on", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await typeEmail(page, outsideEmail);
  await page.getByRole("button", { name: "Use single sign-on instead" }).click();
  await expect(page.getByRole("heading", { name: "Continue with your institution" })).toBeVisible();
  await expect(page.getByText("Matches your email")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Institution or email domain" }).fill("cuni");
  await expect(page.getByRole("radio")).toHaveCount(1);
  await page.getByRole("radio", { name: /Charles University AI Lab/ }).click();
  await page.getByRole("button", { name: "Continue to Charles University sign-in" }).click();
  await expect(page).toHaveURL(slideUrl);
});

test("a sign-in link works with its code, and a wrong code is refused", async ({ page }) => {
  await page.goto("/sign-in");
  await typeEmail(page, outsideEmail);
  await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText(outsideEmail)).toBeVisible();
  const signInWithCode = page.getByRole("button", { name: "Sign in with the code" });
  await expect(signInWithCode).toBeDisabled();
  await page.getByLabel("Sign-in code").fill("000000");
  await signInWithCode.click();
  await expect(page.getByRole("alert")).toContainText("That code is wrong or has expired");
  await expect(page.getByLabel("Sign-in code")).toHaveValue("");
  await page.getByLabel("Sign-in code").fill(code);
  await expect(signInWithCode).toBeEnabled();
  await signInWithCode.click();
  await expect(page).toHaveURL(slideUrl);
});

test("resending the link shows a notice and starts the wait again", async ({ page }) => {
  await page.goto("/sign-in?scene=magic");
  await page.getByRole("button", { name: /Resend in/ }).click();
  await expect(page.getByText("Sends a new link. The old one stops working")).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend in 0:4/ })).toBeVisible();
});

test("a reset checks length, reuse and known leaks before it signs in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await typeEmail(page, "lenka@fnvltava.example");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  const save = page.getByRole("button", { name: "Save and sign in" });
  const fill = async (value: string, repeat = value) => {
    await page.getByLabel("New password").fill(value);
    await page.getByLabel("Repeat it").fill(repeat);
  };
  const length = page.getByRole("listitem").filter({ hasText: "At least 12 characters" });
  const reuse = page.getByRole("listitem").filter({ hasText: "Not one you used before" });
  const leaks = page.getByRole("listitem").filter({ hasText: "Not found in known leaks" });

  await fill("short");
  await expect(length).toContainText("not met");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Use at least 12 characters");

  await fill("spring-meadow-2025");
  await expect(length).toContainText(", met");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("You used this password before");
  await expect(reuse).toContainText("not met");
  await expect(leaks).toContainText(", met");

  await fill("password1234");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("This password is in known leaks");
  await expect(leaks).toContainText("not met");

  await fill("a-fresh-long-passphrase", "a-different-passphrase");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("The two passwords are not the same");

  await fill("a-fresh-long-passphrase");
  await expect(page.getByRole("meter", { name: "Password strength" })).toHaveAttribute(
    "aria-valuetext",
    "Very strong",
  );
  await save.click();
  await expect(page).toHaveURL(slideUrl);
});

test("a deep link carried in return_to lands on its target after sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("After you sign in:")).toBeVisible();
  const target = await defaultTarget(page);
  const slidePath = target.replace(/\?.*$/, "");
  await page.goto(`/sign-in?return_to=${encodeURIComponent(slidePath)}`);
  await expect(page.getByText("After you sign in:")).toContainText("slide");
  await expect(page.getByText("After you sign in:")).not.toContainText("RT-14");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${slidePath}$`));
});

test("a deep link survives a sign-in link and a reset", async ({ page }) => {
  await page.goto("/sign-in?return_to=%2Fmy-work&scene=magic");
  await page.getByLabel("Sign-in code").fill(code);
  await page.getByRole("button", { name: "Sign in with the code" }).click();
  await expect(page).toHaveURL(/\/my-work$/);
  await page.goto("/sign-in?return_to=%2Fmy-work&scene=reset");
  await page.getByLabel("New password").fill("a-fresh-long-passphrase");
  await page.getByLabel("Repeat it").fill("a-fresh-long-passphrase");
  await page.getByRole("button", { name: "Save and sign in" }).click();
  await expect(page).toHaveURL(/\/my-work$/);
});

test("a return target that is not a slide still lands, and one outside the site is ignored", async ({
  page,
}) => {
  await page.goto("/sign-in?return_to=%2Fmy-work");
  await expect(page.getByText("After you sign in:")).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/my-work$/);
  await page.goto("/sign-in?return_to=%2F%2Fevil.example");
  await expect(page.getByText("After you sign in:")).toContainText("RT-14");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(slideUrl);
});

test("an expired session shows the shared page, then the sign-in form", async ({ page }) => {
  await page.goto("/sign-in?scene=expired");
  const shown = page.getByTestId("issue-session-expired");
  await expect(shown).toContainText("Your session ended after 8 hours");
  await shown.getByRole("button", { name: "Sign in to go on" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();
  await expect(page.getByTestId("issue-session-expired")).toHaveCount(0);
});

test("no access shows the shared page and the request turns into Asked", async ({ page }) => {
  await page.goto("/sign-in?scene=noaccess");
  const shown = page.getByTestId("issue-no-access");
  await expect(shown).toContainText("Its owner is Lenka Malá");
  await shown.getByRole("button", { name: "Ask for access" }).click();
  await expect(shown.getByRole("button", { name: "Asked Lenka Malá" })).toBeDisabled();
});
