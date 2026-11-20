import { report, watch } from "../smoke/watch.ts";
import { expect, type Page, test } from "./a11y.ts";

const fakeSessionKey = "parfocal.fake-session";

function apiPathOf(address: string): string | null {
  const path = new URL(address).pathname;
  const at = path.indexOf("/api/");
  return at === -1 ? null : path.slice(at);
}

function allowedBeforeSignIn(path: string): boolean {
  return path === "/api/me" || path === "/api/status" || path.startsWith("/api/auth/");
}

async function startAs(page: Page, session: "signed-out" | "expired" | "ended") {
  await page.addInitScript(([key, value]) => window.sessionStorage.setItem(key, value), [
    fakeSessionKey,
    session,
  ] as const);
  const asked: string[] = [];
  const answeredOn: string[] = [];
  let where = "";
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) where = new URL(frame.url()).pathname;
  });
  page.on("request", (request) => {
    const path = apiPathOf(request.url());
    if (path !== null) asked.push(path);
  });
  page.on("requestfinished", (request) => {
    if (apiPathOf(request.url()) === "/api/me") answeredOn.push(where);
  });
  return { asked, answeredOn };
}

const signInHeading = (page: Page) => page.getByRole("heading", { name: "Sign in to Parfocal" });

test("a signed-out visitor asks only who is signed in before the sign-in page", async ({
  page,
  context,
  baseURL,
}) => {
  const seen = await watch(context, baseURL ?? "");
  const { asked, answeredOn } = await startAs(page, "signed-out");
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?return_to=%2F$/);
  await expect(signInHeading(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(asked).toContain("/api/me");
  expect(asked.filter((path) => !allowedBeforeSignIn(path))).toEqual([]);
  expect(answeredOn.filter((path) => path === "/")).toHaveLength(1);
  expect(seen.problems, report(seen.problems)).toEqual([]);
});

test("an expired session goes to sign-in with the return path, never to the lock screen", async ({
  page,
}) => {
  const { asked } = await startAs(page, "expired");
  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/sign-in\?return_to=%2Fmy-work$/);
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Locked" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(asked.filter((path) => !allowedBeforeSignIn(path))).toEqual([]);
});

test("a session that ended shows the session ended page, then the sign-in form", async ({
  page,
}) => {
  await startAs(page, "ended");
  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/sign-in\?return_to=%2Fmy-work&ended=8$/);
  const shown = page.getByTestId("issue-session-expired");
  await expect(shown).toContainText("Your session ended after 8 hours");
  await expect(shown).toContainText("Everything you saved is kept.");
  await expect(shown).not.toContainText("Your last save was");
  await shown.getByRole("button", { name: "Sign in to go on" }).click();
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByTestId("issue-session-expired")).toHaveCount(0);
});

test("the first paint shows the boot loader with the product name", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  const loader = page.getByTestId("boot-loader");
  await expect(loader).toBeVisible();
  await expect(loader.getByText("Parfocal", { exact: true })).toBeVisible();
  await context.close();
});

test("the app replaces the boot loader once it has mounted", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByTestId("boot-loader")).toHaveCount(0);
});
