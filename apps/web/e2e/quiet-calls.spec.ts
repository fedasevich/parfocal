import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const masklessKey = "parfocal.fake.maskless-slides";

function recordCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) calls.push(url.pathname);
  });
  return calls;
}

const count = (calls: string[], pattern: RegExp) =>
  calls.filter((path) => pattern.test(path)).length;

test("a slide with no running run asks for model runs once and never again", async ({ page }) => {
  test.setTimeout(60_000);
  const calls = recordCalls(page);
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect.poll(() => count(calls, /\/model-runs$/)).toBeGreaterThan(0);
  const asked = count(calls, /\/model-runs$/);
  await page.waitForTimeout(30_000);
  expect(count(calls, /\/model-runs$/)).toBe(asked);
});

test("a slide without a tissue mask is asked about once", async ({ page }) => {
  test.setTimeout(60_000);
  const calls = recordCalls(page);
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).first().click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  const slideId = /\/slides\/([^/?]+)/.exec(new URL(page.url()).pathname)?.[1] ?? "";
  expect(slideId).not.toBe("");
  await page.addInitScript(
    ([key, id]) => sessionStorage.setItem(key ?? "", JSON.stringify([id])),
    [masklessKey, slideId],
  );
  calls.length = 0;
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-coverage", "loaded");
  await page.waitForTimeout(3_000);
  expect(count(calls, /\/tissue$/)).toBe(1);
});

test("leaving the viewer does not ask the shell's calls again", async ({ page }) => {
  test.setTimeout(60_000);
  const calls = recordCalls(page);
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await page.waitForTimeout(1_000);
  calls.length = 0;
  await page.goBack();
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
  await page.waitForTimeout(2_000);
  const shell = calls.filter((path) => /^\/api\/(me|projects|home|review-tasks)/.test(path));
  expect(shell).toEqual([]);
});

test("Home project cards and slide rows show a thumbnail image", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("slide-thumb").first();
  await expect(card).toBeVisible();
  await expect
    .poll(() => card.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.goto(`/projects/${p07}?tab=slides`);
  const row = page.getByTestId("slide-row").first().getByTestId("slide-thumb");
  await expect(row).toBeVisible();
  await expect
    .poll(() => row.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});
