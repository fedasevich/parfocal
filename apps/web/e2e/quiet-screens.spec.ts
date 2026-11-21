import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

function listen(page: Page, answered: string[] = []) {
  const noise: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") noise.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => noise.push(`page: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) answered.push(url.pathname);
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      noise.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
    }
  });
  return noise;
}

const screens: readonly (readonly [string, string, string])[] = [
  ["home", "/", "main"],
  ["my work", "/my-work", "main"],
  ["the project", `/projects/${p07}`, "main"],
  ["the project slides", `/projects/${p07}?tab=slides`, "main"],
  ["the dataset of a review task not signed off", `/tasks/${rt14}/dataset`, "dataset-refusal"],
];

for (const [name, path, ready] of screens) {
  test(`${name} opens with no console error and no failed call`, async ({ page }) => {
    const answered: string[] = [];
    const noise = listen(page, answered);
    await page.goto(path);
    if (ready === "main") await expect(page.locator("main").first()).toBeVisible();
    else await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    expect(noise).toEqual([]);
    if (ready === "dataset-refusal") {
      expect(answered).toContain(`/api/review-tasks/${rt14}/states`);
      expect(answered.filter((each) => each.endsWith("/dataset"))).toEqual([]);
    }
  });
}

test("a slide with results opens in the viewer with no console error and no failed call", async ({
  page,
}) => {
  const answered: string[] = [];
  const noise = listen(page, answered);
  await page.goto(`/projects/${p07}/slides/${tumor044}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  expect(answered.some((path) => path.includes("/result-sets"))).toBe(true);
  expect(noise).toEqual([]);
});
