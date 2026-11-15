import { type BrowserContext, expect, test } from "@playwright/test";
import { errorScreenShown, watch } from "../smoke/watch.ts";

const origin = "https://smoke-selftest.invalid";

const brokenBuild = `<!doctype html><html><body>
<main data-testid="issue-server-error"><h1>Something went wrong on our side</h1></main>
<script>
console.error("Cannot read properties of undefined (reading 'projects')");
fetch("/api/me");
fetch("/api/projects/p1/archive", { method: "POST" }).catch(() => undefined);
</script></body></html>`;

const healthyBuild = `<!doctype html><html><body>
<main><h1>Sign in to Parfocal</h1></main>
<script>fetch("/api/me"); fetch("/api/auth/sign-in", { method: "POST" });</script>
</body></html>`;

async function serve(context: BrowserContext, html: string, meStatus: number) {
  await context.route(`${origin}/`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  await context.route(`${origin}/api/**`, (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/api/me") ? meStatus : 200,
      body: "{}",
    }),
  );
}

test("the deploy smoke fails a deliberately broken build and passes a healthy one", async ({
  browser,
}) => {
  const broken = await browser.newContext();
  await serve(broken, brokenBuild, 500);
  const brokenSeen = await watch(broken, origin);
  brokenSeen.signedIn();
  const brokenPage = await broken.newPage();
  await brokenPage.goto(`${origin}/`);
  await expect
    .poll(() => brokenSeen.problems.map((problem) => problem.kind).sort())
    .toEqual(["api", "console", "write"]);
  expect(await errorScreenShown(brokenPage)).toBe("issue-server-error");
  await broken.close();

  const healthy = await browser.newContext();
  await serve(healthy, healthyBuild, 401);
  const healthySeen = await watch(healthy, origin);
  const healthyPage = await healthy.newPage();
  await healthyPage.goto(`${origin}/`);
  await expect(healthyPage.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();
  await healthyPage.waitForLoadState("networkidle");
  expect(healthySeen.problems).toEqual([]);
  expect(await errorScreenShown(healthyPage)).toBeNull();
  await healthy.close();
});
