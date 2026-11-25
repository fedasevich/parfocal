import { expect, type Page, test } from "@playwright/test";
import { answerLastQuestions, walkRound5 } from "../e2e/study-round5-walk.ts";
import { signIn } from "./session.ts";

const wanted = process.env["PARFOCAL_STUDY_JOIN"] === "1";

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 45_000 });

async function makeLink(page: Page): Promise<{ code: string; url: string }> {
  await page.goto("/study/console");
  await page.getByRole("textbox", { name: "Code to prepare" }).fill("");
  await page.getByRole("button", { name: "Make a join link" }).click();
  const status = page.getByTestId("study-prepare-status");
  await expect(status).toHaveText(/^Study P-[A-Z0-9]{4} is ready\./, { timeout: 300_000 });
  const code = (await page.getByRole("textbox", { name: "Code to prepare" }).inputValue()).trim();
  const url = await page.getByTestId("study-join-link").inputValue();
  expect(url).toContain("/study/join#");
  const switchTo = page.getByTestId("study-prepare-switch").getByRole("button");
  if (await switchTo.isVisible()) {
    await switchTo.click();
    await expect(page.getByTestId("study-prepare-switch")).toHaveCount(0, { timeout: 30_000 });
  }
  return { code, url };
}

test("one join link goes from the console to the thank you page in a fresh browser", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!wanted, "PARFOCAL_STUDY_JOIN=1 runs the deployed join link dry run");
  test.setTimeout(1_200_000);
  const origin = baseURL ?? "https://app.parfocal.eu";
  await signIn(page, origin);
  const { code, url } = await test.step("make the link", () => makeLink(page));
  test.info().annotations.push({ type: "participant", description: code });

  const remote = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
  });
  const participant = await remote.newPage();
  await test.step("open the link", async () => {
    await participant.goto(url);
    await expect(participant).toHaveURL(/\/study$/, { timeout: 60_000 });
    await expect(participant.getByTestId("study-code")).toHaveText(code);
  });
  await walkRound5(participant, {
    code,
    reviewSlideLink: (on) => on.getByRole("link", { name: /^Study review 1\b/ }),
    secondSlide: /^Study review 2\b/,
  });
  await test.step("thank you", () => answerLastQuestions(participant));

  await test.step("the console follows", async () => {
    await page.goto("/study/console");
    await expect(
      page.locator(`[data-testid="study-remote-progress"][data-code="${code}"]`),
    ).toHaveAttribute("data-kind", "finished", { timeout: 60_000 });
  });
  await test.step("the link is spent", async () => {
    const again = await remote.newPage();
    await again.goto(url);
    await expect(again.getByTestId("study-join-status")).toContainText("used already", {
      timeout: 30_000,
    });
  });
  await remote.close();
  await test.step("dry run", async () => {
    const session = page.getByTestId(`study-result-${code}`);
    await expect(session).toBeVisible({ timeout: 60_000 });
    await session.getByRole("checkbox", { name: "Dry run" }).click();
    await expect(session).toHaveAttribute("data-dry-run", "true");
  });
  await test.step("remove", async () => {
    await page.getByRole("textbox", { name: "Code to prepare" }).fill(code);
    await page.getByRole("button", { name: "Remove the project" }).click();
    await expect(page.getByTestId("study-prepare-status")).toHaveText(
      `The project of ${code} is removed.`,
      { timeout: 300_000 },
    );
  });
});
