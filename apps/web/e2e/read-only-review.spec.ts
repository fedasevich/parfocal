import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";

test.use({ viewport: { width: 1440, height: 900 } });

const readOnlyLine = /^Read only\. This slide is assigned to .+\.$/;

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

async function openFirstObject(page: Page) {
  const row = page.getByTestId("stage-review-objects").getByTestId("object-row").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button").click();
  const foot = page.getByTestId("object-foot");
  await expect(foot).toBeVisible();
  return foot;
}

test("someone not assigned opens another reviewer's slide read only, with no answer controls", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&as=DH`);
  await ready(page);
  const notice = page.getByTestId("read-only-notice");
  await expect(notice).toContainText("Read only.");
  await expect(notice).toContainText(
    /This slide is assigned to .+, so you can look but not answer\./,
  );
  const foot = await openFirstObject(page);
  await expect(page.getByTestId("read-only-note")).toHaveText(readOnlyLine);
  await expect(foot.getByRole("group", { name: /^Your answer on/ })).toHaveCount(0);
  await expect(foot.getByTestId("answers-off")).toHaveText(readOnlyLine);
  await expect(page.getByTestId("viewer-banner").getByTestId("signed-off-notice")).toHaveCount(0);
});

test("the assigned reviewer of the same slide still gets the answer controls", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
  await ready(page);
  const foot = await openFirstObject(page);
  await expect(foot.getByRole("group", { name: /^Your answer on/ })).toBeVisible();
  await expect(page.getByTestId("read-only-notice")).toHaveCount(0);
  await expect(page.getByTestId("read-only-note")).toHaveCount(0);
});

test("guided review of another reviewer's task shows the object without answers", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?as=DH`);
  await ready(page);
  const card = page.getByTestId("stage-review-object");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("read-only-note")).toHaveText(readOnlyLine);
  await expect(card.getByRole("group", { name: /^Your answer on/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Add something the AI missed" })).toHaveCount(0);
  await expect(page.getByTestId("read-only-notice")).toBeVisible();
});

test("guided review read only never asks for display settings it may not have", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/my-display")) asked.push(request.url());
  });
  await page.goto(`/tasks/${rt14}/guided?as=DH`);
  await ready(page);
  await expect(page.getByTestId("stage-review-object")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("read-only-notice")).toBeVisible();
  expect(asked).toEqual([]);
});

for (const [code, sentence] of [
  [
    "not-assigned",
    "Only the people assigned to this task can do that. You can look at it read only.",
  ],
  [
    "unknown-object",
    "That object is no longer in this result, so nothing was changed. Reload the slide and try again.",
  ],
] as const) {
  test(`a refused check says ${code} as a plain sentence`, async ({ page }) => {
    await page.goto(
      `/projects/${p07}/slides/${withResults}?task=${annotateTask}&as=DH&refuse=${code}`,
    );
    await ready(page);
    await expect(page.getByTestId("ai-object")).toHaveCount(6);
    await page.keyboard.press("Shift+G");
    await expect(page.getByTestId("guided-check")).toHaveAttribute("data-current", "C1");
    await page.keyboard.press("d");
    const alert = page.getByRole("alert").filter({ hasText: sentence });
    await expect(alert).toHaveText(sentence);
    await expect(page.getByText(code, { exact: false })).toHaveCount(0);
  });
}
