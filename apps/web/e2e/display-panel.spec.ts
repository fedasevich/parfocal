import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./a11y.ts";

test.describe.configure({ timeout: 90_000 });

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const guidedUrl = (scene: string) => `/tasks/${rt14}/guided?slide=${a1}&scene=${scene}`;

const panel = (page: Page) => page.getByRole("tabpanel");

const undoOf = (page: Page, preset: string) =>
  page
    .getByRole("status")
    .filter({ hasText: `Display: ${preset}` })
    .getByRole("button", { name: "Undo" });

const presetButton = (page: Page) => panel(page).getByRole("button", { name: /Task default|Dots/ });

async function decisionsOf(page: Page) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return (await response.json()) as { object: string; preset: string | null }[];
  }, `/api/review-tasks/${rt14}/slides/${a1}/verdicts`);
}

test("each group folds to a one-line summary", async ({ page }) => {
  await page.goto(guidedUrl("display"));
  const body = panel(page);
  const summaries: [RegExp, string][] = [
    [/How objects draw/, "Outline 2 px · by class · IDs on"],
    [/What the AI shows/, "Confidence as a number · heatmap off · cutoff 0.40"],
    [/How the review moves/, "AI order · fit · moves on by itself"],
  ];
  for (const [title, summary] of summaries) {
    await expect(body.getByText(summary)).toBeHidden();
    await body.getByRole("button", { name: title }).click();
    await expect(body.getByText(summary)).toBeVisible();
  }
  await expect(body.getByRole("radiogroup", { name: "Draw as" })).toBeHidden();
});

test("changing a setting updates the summary, marks the preset and keeps Save blocked on the task default", async ({
  page,
}) => {
  await page.goto(guidedUrl("display"));
  const body = panel(page);
  await body
    .getByRole("radiogroup", { name: "Width" })
    .getByRole("radio", { name: "3 px" })
    .click();
  await expect(body.getByRole("img", { name: "Changed since you picked it" })).toBeVisible();
  await body.getByRole("button", { name: /How objects draw/ }).click();
  await expect(body.getByText("Outline 3 px · by class · IDs on")).toBeVisible();
  await presetButton(page).click();
  const save = page.getByRole("menuitem", { name: /^Save\b(?! as)/ });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toContainText("Task default can't be changed");
});

test("Save is disabled with the reason Nothing changed", async ({ page }) => {
  await page.goto(guidedUrl("display"));
  await presetButton(page).click();
  const save = page.getByRole("menuitem", { name: /^Save\b(?! as)/ });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toContainText("Nothing changed");
});

test("Save as refuses a name that is already taken and then saves a new one", async ({ page }) => {
  await page.goto(guidedUrl("display"));
  await presetButton(page).click();
  await page.getByRole("menuitem", { name: "Save as" }).click();
  const modal = page.getByRole("dialog", { name: "Save a preset" });
  await modal.getByRole("textbox").fill("tumor first");
  await modal.getByRole("button", { name: /^Save/ }).click();
  await expect(modal.getByText("You already have a preset called Tumor first.")).toBeVisible();
  await modal.getByRole("textbox").fill("Fill by score");
  await modal.getByRole("button", { name: /^Save/ }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText("Preset Fill by score saved.")).toBeVisible();
  await expect(presetButton(page)).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /Fill by score/ })).toBeVisible();
});

test("a locked control is read-only text with the task's reason", async ({ page }) => {
  await page.goto(guidedUrl("display"));
  await expect(panel(page).getByText(/Locked by RT-14: everyone sees the objects/)).toBeVisible();
  await expect(panel(page).getByRole("radiogroup", { name: "Order" })).toHaveCount(0);
  await page.goto(guidedUrl("locked"));
  await expect(
    panel(page).getByText("Locked by RT-14: confidence hidden this round"),
  ).toBeVisible();
});

test("Shift+3 switches to the second preset with an Undo and Shift+1 goes back", async ({
  page,
}) => {
  await page.goto(guidedUrl("display"));
  await page.locator("main").press("Shift+3");
  await undoOf(page, "Dots, no IDs").click();
  await expect(panel(page).getByRole("button", { name: /Task default/ })).toBeVisible();
  await page.locator("main").press("Shift+2");
  await expect(panel(page).getByRole("button", { name: /Tumor first/ })).toBeVisible();
  await page.locator("main").press("Shift+1");
  await expect(panel(page).getByRole("button", { name: /Task default/ })).toBeVisible();
});

test("the panel passes axe", async ({ page }) => {
  await page.goto(guidedUrl("display"));
  await expect(panel(page).getByText("Only for you, on RT-14.")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[role="tabpanel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  expect(results.violations.map((item) => item.id)).toEqual([]);
});

test("the preset in force is recorded with the next decision in guided review", async ({
  page,
}) => {
  await page.goto(guidedUrl("region"));
  await page.getByRole("tab", { name: "Display" }).click();
  await page.locator("main").press("Shift+3");
  await expect(panel(page).getByRole("button", { name: /Dots, no IDs/ })).toBeVisible();
  await page.getByRole("tab", { name: "Review" }).click();
  await panel(page).getByRole("button", { name: /Agree/ }).first().click();
  await expect
    .poll(async () => (await decisionsOf(page)).map((item) => item.preset))
    .toContain("Dots, no IDs");
});

test("in the full viewer a preset switches with the keys and is recorded with the next decision", async ({
  page,
}) => {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  const url = new URL(page.url());
  const task = url.searchParams.get("task") ?? rt14;
  const slide = url.pathname.split("/").pop() ?? a1;
  const side = page.getByRole("complementary", { name: "Side panel" });
  await page.getByRole("tab", { name: "Display" }).click();
  await page.locator("body").press("Shift+3");
  await expect(side.getByRole("button", { name: /Dots, no IDs/ })).toBeVisible();
  await page.locator("body").press("Shift+2");
  await undoOf(page, "Tumor first").click();
  await expect(side.getByRole("button", { name: /Dots, no IDs/ })).toBeVisible();
  await page.getByRole("tab", { name: "Objects" }).click();
  await side.getByRole("button", { name: /^T5 Tumor region/ }).click();
  await page
    .getByRole("group", { name: "Your answer on T5" })
    .getByRole("button", { name: /Agree/ })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async (target) => {
        const response = await fetch(target);
        const rows = (await response.json()) as { preset: string | null }[];
        return rows.map((row) => row.preset);
      }, `/api/review-tasks/${task}/slides/${slide}/verdicts`),
    )
    .toContain("Dots, no IDs");
});
