import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const rt09 = "00000000-0000-4000-8007-000000000009";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

const guidedOf = (task: string, issue?: string) =>
  `/tasks/${task}/guided?slide=${a1}${issue === undefined ? "" : `&issue=${issue}`}`;

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

async function answersOff(page: Page, reason: string) {
  await expect(page.getByText(reason, { exact: true })).toBeVisible({ timeout: 15_000 });
  const answers = page.getByRole("group", { name: /^Your answer on / }).getByRole("button");
  await expect(answers.first()).toBeVisible();
  for (const button of await answers.all()) await expect(button).toBeDisabled();
}

test("guided review of a withdrawn task says so and locks the answers", async ({ page }) => {
  await page.goto(guidedOf(rt14, "withdrawn"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "withdrawn");
  await expect(card).toContainText("This task was withdrawn.");
  await answersOff(page, "This task was withdrawn. There is nothing left to decide.");
  await card.getByRole("button", { name: "Back to My work" }).click();
  await expect(page).toHaveURL(/\/my-work/);
});

test("guided review of a signed off task is read only and asks for an amendment", async ({
  page,
}) => {
  await page.goto(guidedOf(rt09));
  await ready(page);
  const notice = page.getByTestId("viewer-banner").getByTestId("signed-off-notice");
  await expect(notice).toContainText("Signed off 9 Oct. Changes need an amendment.", {
    timeout: 15_000,
  });
  await answersOff(page, "Signed off. Ask the researcher to amend.");
});

test("guided review of a slide unreadable at high power says so and retries", async ({ page }) => {
  await page.goto(guidedOf(rt14, "slidefail"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "slidefail", { timeout: 15_000 });
  await expect(card).toContainText(/could not be read at the highest magnifications\./);
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
});

test("guided review of a slide with no AI result says so and moves on", async ({ page }) => {
  await page.goto(guidedOf(rt14, "noresults"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "noresults");
  await expect(card).toContainText(/No AI result on .+ yet\./);
  await card.getByRole("button", { name: "Next slide" }).click();
  await expect(page).not.toHaveURL(new RegExp(`slide=${a1}`));
});

test("guided review of a slide whose AI found nothing says so and moves on", async ({ page }) => {
  await page.goto(guidedOf(rt14, "empty"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "nothingfound");
  await expect(card).toContainText(/The AI found nothing to decide on .+\./);
  await expect(card).toContainText("Look over the slide yourself, or go on to the next slide.");
  await card.getByRole("button", { name: "Next slide" }).click();
  await expect(page).not.toHaveURL(new RegExp(`slide=${a1}`));
});
