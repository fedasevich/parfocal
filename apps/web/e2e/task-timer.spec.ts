import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

type Logged = { name: string; properties: Record<string, string | number> };

const allowAnalytics = (page: Page) =>
  page.addInitScript(() => {
    window.localStorage.setItem(
      "parfocal.device-settings",
      JSON.stringify({ analytics_policy: "on", analytics_opt_out: false }),
    );
  });

const logged = (page: Page) =>
  page.evaluate(
    () => JSON.parse(window.localStorage.getItem("parfocal.event-log") ?? "[]") as Logged[],
  );

const named = (log: Logged[], name: string) => log.filter((entry) => entry.name === name);

test("reviewing a slide and signing it out sends slide, area and cell times", async ({ page }) => {
  await allowAnalytics(page);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=grid`);
  await page.getByRole("tabpanel").getByRole("button", { name: /Agree/ }).first().click();
  await expect.poll(async () => named(await logged(page), "cell_review_timed").length).toBe(1);

  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=required`);
  await page
    .getByRole("radiogroup", { name: "Is the AI result acceptable for this slide?" })
    .getByRole("radio", { name: "4" })
    .click();
  await page.getByRole("button", { name: /Submit and open slide 9/ }).click();
  await expect(page).toHaveURL(/\/submitted\?/);

  await page.goto(`/tasks/${rt14}/sign-off?scene=ready`);
  await page.getByRole("button", { name: /^Sign with Vltava SSO/ }).click();
  await expect
    .poll(async () => named(await logged(page), "task_finished").length, { timeout: 15_000 })
    .toBe(2);

  const log = await logged(page);
  expect(named(log, "cell_review_timed")[0]?.properties["slide_id"]).toBe(a1);
  const finished = named(log, "task_finished");
  expect(finished.map((entry) => entry.properties["task_kind"])).toEqual(["review", "report"]);
  expect(finished[0]?.properties["case_id"]).toBe(a1);
  expect(finished[1]?.properties["case_id"]).toBe(rt14);
  expect(named(log, "area_time_recorded").map((entry) => entry.properties["area"])).toContain(
    "viewer",
  );

  await page.goto("/kpi");
  await expect(page.getByTestId("kpi-seeded-note")).toHaveAttribute("data-source", "recorded");
  await expect(page.getByTestId("kpi-review")).toContainText("1");
});

test("the full viewer samples how much of the screen its chrome covers", async ({ page }) => {
  await allowAnalytics(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
  await expect(page.getByTestId("full-viewer")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => named(await logged(page), "chrome_coverage_measured").length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  const sample = named(await logged(page), "chrome_coverage_measured")[0];
  expect(sample?.properties["area"]).toBe("viewer");
  expect(Number(sample?.properties["coverage_permille"])).toBeGreaterThan(0);
  expect(Number(sample?.properties["coverage_permille"])).toBeLessThan(350);
});

test("nothing is recorded or sent after the person opts out", async ({ page }) => {
  await allowAnalytics(page);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=required`);
  await expect(page.getByRole("radiogroup", { name: "How to review" })).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem(
      "parfocal.device-settings",
      JSON.stringify({ analytics_policy: "off", analytics_opt_out: true }),
    );
    window.localStorage.removeItem("parfocal.event-log");
  });
  await page
    .getByRole("radiogroup", { name: "Is the AI result acceptable for this slide?" })
    .getByRole("radio", { name: "4" })
    .click();
  await page.getByRole("button", { name: /Submit and open slide 9/ }).click();
  await expect(page).toHaveURL(/\/submitted\?/);
  expect(await logged(page)).toEqual([]);
});
