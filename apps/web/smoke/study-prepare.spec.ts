import { expect, type Page, test } from "@playwright/test";
import { answerLastQuestions, walkRound5 } from "../e2e/study-round5-walk.ts";
import { signIn } from "./session.ts";

const wanted = process.env["PARFOCAL_STUDY_PREPARE"] === "1";

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 45_000 });

async function prepareFromConsole(page: Page): Promise<string> {
  await page.goto("/study");
  const code = (await page.getByTestId("study-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^P-[A-Z0-9]{4}$/);
  await page.goto("/study/console");
  await expect(page.getByRole("textbox", { name: "Code to prepare" })).toHaveValue(code);
  await page.getByRole("button", { name: "Prepare the participant" }).click();
  await expect(page.getByTestId("study-prepare-status")).toHaveText(
    new RegExp(`^Study ${code} is ready in `),
    { timeout: 300_000 },
  );
  const switchTo = page.getByTestId("study-prepare-switch").getByRole("button");
  if (await switchTo.isVisible()) {
    await switchTo.click();
    await expect(page.getByTestId("study-prepare-switch")).toHaveCount(0, { timeout: 30_000 });
  }
  return code;
}

test("one code goes from Prepare in the console to the thank you page on the deployed app", async ({
  page,
  baseURL,
}) => {
  test.skip(!wanted, "PARFOCAL_STUDY_PREPARE=1 runs the deployed prepare dry run");
  test.setTimeout(1_200_000);
  await signIn(page, baseURL ?? "https://app.parfocal.eu");
  const code = await test.step("prepare", () => prepareFromConsole(page));
  test.info().annotations.push({ type: "participant", description: code });
  await walkRound5(page, {
    code,
    reviewSlideLink: (on) => on.getByRole("link", { name: /^Study review 1\b/ }),
    secondSlide: /^Study review 2\b/,
  });
  await test.step("thank you", () => answerLastQuestions(page));
  await test.step("dry run", async () => {
    await page.goto("/study/console");
    const session = page.getByTestId(`study-result-${code}`);
    await expect(session).toBeVisible({ timeout: 60_000 });
    await session.getByRole("checkbox", { name: "Dry run" }).click();
    await expect(session).toHaveAttribute("data-dry-run", "true");
  });
  await test.step("remove", async () => {
    await page.goto("/study/console");
    await page.getByRole("textbox", { name: "Code to prepare" }).fill(code);
    await page.getByRole("button", { name: "Remove the project" }).click();
    await expect(page.getByTestId("study-prepare-status")).toHaveText(
      `The project of ${code} is removed.`,
      { timeout: 300_000 },
    );
  });
});
