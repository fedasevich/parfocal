import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const survey = (page: Page) => page.getByRole("region", { name: "Quick survey" });

async function turnSurveysOn(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "parfocal.device-settings",
      JSON.stringify({
        surveys_on: true,
        analytics_policy: "on",
        survey_state: {
          sessions: 9,
          susSessionsAtPrompt: 0,
          susNotBefore: 0,
          seqNotBefore: 0,
          seqKindNotBefore: {},
        },
      }),
    );
  });
}

test("no survey covers the slide list or the viewer while someone works", async ({ page }) => {
  test.slow();
  await turnSurveysOn(page);
  await page.goto("/");
  await expect(page.getByRole("main").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(survey(page)).toBeHidden();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(survey(page)).toBeHidden();
});

test("submitting a review task offers the survey when surveys are on", async ({ page }) => {
  test.slow();
  await turnSurveysOn(page);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=done`);
  await expect(survey(page)).toBeHidden();
  await page.getByRole("button", { name: /Submit and open slide 9/ }).click();
  await expect(page).toHaveURL(/\/submitted\?/);
  await expect(survey(page)).toBeVisible({ timeout: 10_000 });
});

test("submitting a review task offers no survey when surveys are off", async ({ page }) => {
  test.slow();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=done`);
  await page.getByRole("button", { name: /Submit and open slide 9/ }).click();
  await expect(page).toHaveURL(/\/submitted\?/);
  await page.waitForTimeout(2000);
  await expect(survey(page)).toBeHidden();
});
