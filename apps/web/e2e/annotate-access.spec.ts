import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const annotateTask = "00000000-0000-4000-8007-000000000021";

test.use({ viewport: { width: 1440, height: 900 } });

const annotateOf = (issue?: string) =>
  `/projects/${p07}/slides/${tumor044}?task=${annotateTask}${issue === undefined ? "" : `&issue=${issue}`}`;

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

async function lookOnly(page: Page, reason: string, sentence: string) {
  const stage = await ready(page);
  await expect(stage).toHaveAttribute("data-access", "read-only", { timeout: 15_000 });
  const notice = page.getByTestId("read-only-notice");
  await expect(notice).toHaveAttribute("data-reason", reason);
  await expect(notice).toContainText(sentence);
  const tools = page.locator("button[data-tool]");
  await expect(tools).toHaveCount(3);
  for (const tool of ["select", "hand", "ruler"]) {
    await expect(page.locator(`button[data-tool=${tool}]`)).toBeVisible();
  }
  await expect(page.getByTestId("mark-slide-checked")).toHaveCount(0);
  await page.keyboard.press("p");
  await expect(stage).not.toHaveAttribute("data-tool", "poly");
}

test("an annotate task opened by someone not assigned is read only with a banner", async ({
  page,
}) => {
  await page.goto(annotateOf("unassigned"));
  await lookOnly(
    page,
    "not-assigned",
    "Only the people assigned to this task can do that. You can look at it read only.",
  );
});

test("a withdrawn annotate task is read only with a banner", async ({ page }) => {
  await page.goto(annotateOf("withdrawn"));
  await lookOnly(
    page,
    "withdrawn",
    "This task was withdrawn, so nothing can be changed. You can look at it read only.",
  );
});

test("the assigned expert keeps the drawing tools and Mark slide checked", async ({ page }) => {
  await page.goto(annotateOf());
  const stage = await ready(page);
  await expect(stage).toHaveAttribute("data-access", "edit");
  await expect(page.locator("button[data-tool=poly]")).toBeVisible();
  await expect(page.getByTestId("mark-slide-checked")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("read-only-notice")).toHaveCount(0);
});
