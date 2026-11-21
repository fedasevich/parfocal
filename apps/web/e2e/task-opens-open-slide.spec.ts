import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";

const goInApp = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, url);

const slideOf = (page: Page) => new URL(page.url()).pathname.split("/slides/")[1]?.split("/")[0];

test("a task opens on the first slide the reviewer has not submitted", async ({ page }) => {
  await page.goto(`/tasks/${rt14}`);
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?/, { timeout: 20_000 });
  const first = slideOf(page);
  expect(first).toBeTruthy();
  const status = await page.evaluate(
    async ({ task, slide }) =>
      (await fetch(`/api/review-tasks/${task}/slides/${slide}/submit`, { method: "POST" })).status,
    { task: rt14, slide: first },
  );
  expect(status).toBeLessThan(300);
  await goInApp(page, `/tasks/${rt14}`);
  await expect.poll(() => slideOf(page), { timeout: 20_000 }).not.toBe(first);
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?task=/);
});
