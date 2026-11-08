import { expect, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const tumorClassSuffix = "-class-1";
const shownScore = Math.round(0.54 * 255);

test("a cell decision sends the class and score the screen showed and the API keeps them", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=grid`);
  await expect(page.getByText("The AI says this is a tumor cell, only 54% sure.")).toBeVisible();
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && /\/verdicts\/T\d·C\d+$/.test(decodeURIComponent(request.url())),
  );
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: /Disagree/ })
    .first()
    .click();
  const request = await saved;
  const body = request.postDataJSON() as { ai_class_id?: string; ai_score?: number };
  expect(body.ai_class_id?.endsWith(tumorClassSuffix)).toBe(true);
  expect(body.ai_score).toBe(shownScore);

  type Kept = { ai_class_id: string | null; ai_score: number | null };
  const read = await page.evaluate(
    async (url): Promise<Kept[]> => (await fetch(url)).json() as Promise<Kept[]>,
    request.url().replace(/\/[^/]+$/, ""),
  );
  const kept = read.filter((item) => item.ai_score === shownScore);
  expect(kept.length).toBeGreaterThan(0);
  expect(kept[0]?.ai_class_id?.endsWith(tumorClassSuffix)).toBe(true);
});
