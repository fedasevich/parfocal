import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./a11y.ts";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const violationsOf = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
};

test("the banner and the inline error render in one style and pass axe", async ({ page }) => {
  await page.goto("/issue-pages/styles");
  await expect(page.getByRole("alert").filter({ hasText: "Connection lost." })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "The due date is in the past." }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Signed off." })).toBeVisible();
  expect(await violationsOf(page)).toEqual([]);
});

test("an unknown address shows the not found page and passes axe", async ({ page }) => {
  await page.goto("/no-such-page-anywhere");
  await expect(page.getByTestId("issue-not-found")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.getByTestId("issue-not-found")).toContainText("nothing was changed");
  expect(await violationsOf(page)).toEqual([]);
  await page.getByRole("button", { name: "Go home" }).click();
  await expect(page.getByTestId("issue-not-found")).toHaveCount(0);
});

test("the server error page says what still works and passes axe", async ({ page }) => {
  await page.goto("/issue-pages/server-error");
  const shown = page.getByTestId("issue-server-error");
  await expect(
    shown.getByRole("heading", { name: "Something went wrong on our side" }),
  ).toBeVisible();
  await expect(shown).toContainText("What you already saved is safe");
  await expect(shown.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await violationsOf(page)).toEqual([]);
});

test("the session expired page offers sign in and passes axe", async ({ page }) => {
  await page.goto("/issue-pages/expired");
  const shown = page.getByTestId("issue-session-expired");
  await expect(shown).toContainText("Your session ended after 8 hours");
  await expect(shown).toContainText("Everything you saved is kept");
  await expect(shown.getByRole("button", { name: "Sign in to go on" })).toBeVisible();
  expect(await violationsOf(page)).toEqual([]);
});

test("no access names the owner and the request turns into Asked", async ({ page }) => {
  await page.goto("/issue-pages/no-access");
  const shown = page.getByTestId("issue-no-access");
  await expect(shown).toContainText("Its owner is Dana Reyes");
  expect(await violationsOf(page)).toEqual([]);
  await shown.getByRole("button", { name: "Ask for access" }).click();
  await expect(shown.getByRole("button", { name: "Asked Dana Reyes" })).toBeDisabled();
  expect(await violationsOf(page)).toEqual([]);
});

test("a lost connection shows the banner, keeps what was typed, retries and confirms", async ({
  page,
  context,
}) => {
  await page.goto("/search");
  const box = page.getByRole("textbox", { name: "Search everything" });
  await box.fill("kept note");
  await context.setOffline(true);
  const banner = page.getByTestId("connection-banner");
  await expect(banner).toContainText("Connection lost.");
  await expect(banner).toContainText("nothing you typed is lost");
  await expect(box).toHaveValue("kept note");
  expect(await violationsOf(page)).toEqual([]);
  await banner.getByRole("button", { name: "Retry now" }).click();
  await expect(banner).toBeVisible();
  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Connection is back." })).toBeVisible();
  await expect(box).toHaveValue("kept note");
});

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test("guided review shows the shared banner for a real lost connection and for the scene", async ({
  page,
  context,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  const banner = page.getByTestId("connection-banner");
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await context.setOffline(true);
  await expect(banner).toContainText("Connection lost.");
  await expect(
    page.getByRole("tabpanel").getByRole("button", { name: /Agree/ }).first(),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Connection is back." })).toBeVisible();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=connlost`);
  await expect(banner).toContainText("Connection lost.");
  await banner.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByText("Still offline")).toBeVisible();
});

test("the full viewer shows the shared banner for the scene and a real lost connection", async ({
  page,
  context,
}) => {
  await page.goto("/prototype");
  await page.getByRole("link", { name: "Full viewer · Issue · connection lost" }).click();
  const banner = page.getByTestId("connection-banner");
  await expect(banner).toContainText("Connection lost.");
  await page.goBack();
  const objectsHref = await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true })
    .getAttribute("href");
  await page.goto(objectsHref ?? "");
  await expect(page.getByRole("tab", { name: /Objects/ }).first()).toBeVisible();
  await expect(banner).toHaveCount(0);
  await context.setOffline(true);
  await expect(banner).toContainText("Connection lost.");
  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
});
