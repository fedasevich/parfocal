import { expect, test } from "./a11y.ts";

const password = "correct-horse-staple";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("parfocal.passkey-offer-declined", "yes"),
  );
});
const slideUrl = /\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?task=[0-9a-f-]+/;

test("a password signs in and lands on the demo slide, a wrong one says so", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The email or password is wrong");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page).toHaveURL(slideUrl);
});

test("the sign-in form offers no flows that the hosted login replaced", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forgot password?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Email me a sign-in link instead" })).toHaveCount(
    0,
  );
});

test("sign in with your organisation asks for the email domain and names an unknown one", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with your organisation" }).click();
  await expect(page.getByRole("heading", { name: "Continue with your institution" })).toBeVisible();
  const go = page.getByRole("button", { name: "Continue to your organisation's sign-in" });
  await page.getByRole("textbox", { name: "Institution or email domain" }).fill("lenka@");
  await expect(go).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Institution or email domain" })
    .fill("lenka@hospital.example");
  await expect(go).toBeEnabled();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();

  await page.goto("/sign-in?sso=none&return_to=%2Fmy-work");
  await expect(page.getByRole("heading", { name: "Continue with your institution" })).toBeVisible();
  await expect(page.getByText("No Parfocal workspace signs in that email domain")).toBeVisible();
});

test("a return target that is not a slide still lands, and one outside the site is ignored", async ({
  page,
}) => {
  await page.goto("/sign-in?return_to=%2Fmy-work");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/my-work$/);
  await page.goto("/sign-in?return_to=%2F%2Fevil.example");
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

test("a project you are not a member of shows no access and asking turns into Asked", async ({
  page,
}) => {
  await page.goto("/projects/00000000-0000-4000-8069-0000000000a1");
  const shown = page.getByTestId("issue-no-access");
  await expect(shown.getByRole("heading", { name: "No access to this project" })).toBeVisible();
  await expect(shown).toContainText("Its owner is Lenka Malá");
  await shown.getByRole("button", { name: "Ask for access" }).click();
  await expect(shown.getByRole("button", { name: "Asked Lenka Malá" })).toBeDisabled();
  await expect(page.getByTestId("project-page")).toHaveCount(0);
});

test("a project that does not exist shows not found, not no access", async ({ page }) => {
  await page.goto("/projects/00000000-0000-4000-8069-0000000000a2");
  await expect(page.getByTestId("issue-not-found")).toBeVisible();
  await expect(page.getByTestId("issue-no-access")).toHaveCount(0);
});

test("the sign-in page shows the annotated slide picture on wide screens and hides it on narrow ones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const picture = page.getByRole("img", { name: "A tissue sample with model outlines" });
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(picture).toHaveAttribute("src", "/models/signin-slide-v1.webp");
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(picture).toBeHidden();
});
