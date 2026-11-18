import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

const bar = (page: Page) => page.getByTestId("live-top-bar");
const inspector = (page: Page) => page.getByTestId("stage-inspector");
const modes = (page: Page) => bar(page).getByTestId("workspace-switch").getByRole("radio");

test("the top bar of RT-14 shows the task, the slide chip, the decision ring and a Submit that waits", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=review`);
  await ready(page);

  const header = bar(page).getByTestId("case-header");
  await expect(header).toContainText("Round 2 · CAMELYON v1.0");
  await expect(header).toContainText("Sentinel node AI evaluation · due Fri 23 Oct");
  await expect(header).not.toContainText("RT-14");
  await expect(header).not.toContainText("result set");
  await expect(bar(page).getByRole("link", { name: "My work" })).toHaveAttribute(
    "title",
    "Back to My work. Every answer is saved",
  );

  const chip = bar(page).getByTestId("slide-picker");
  await expect(chip).toHaveText("A1 · H&E");
  await expect(chip.locator('[data-slot="slide-thumb"]')).toBeVisible();
  const chipBox = await chip.boundingBox();
  expect(chipBox?.x ?? 0).toBeLessThan(480);
  expect(chipBox?.width ?? 0).toBeGreaterThan(120);
  expect(chipBox?.width ?? 0).toBeLessThan(165);

  const progress = bar(page).getByTestId("slide-progress");
  await expect(progress.getByTestId("decision-ring")).toHaveText("87%");
  await expect(progress).toContainText("Slide 8 of 12");
  await expect(progress).toContainText("about 1 h 20 min left");
  await expect(progress.getByTestId("viewed-ring")).toHaveCount(0);

  await expect(modes(page)).toHaveText(["Guided", "Full viewer"]);
  await expect(modes(page).filter({ hasText: "Full viewer" })).toBeChecked();

  const submit = bar(page).getByTestId("top-submit");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("title", "7 objects are still open.");

  await bar(page).getByTestId("progress-trigger").click();
  const popover = page.getByRole("dialog", { name: "Review progress" });
  await expect(popover).toContainText("48 of 55");
  await expect(popover.locator('[data-slot="progress-ring"]')).toHaveText("87%");
  await expect(popover.locator('[data-slot="legend-added"]')).toHaveText("Added, T6⁺1");
  await expect(popover).toContainText("Still open7");
  await expect(popover).toContainText("of the tissue seen at 10x or more");
  await page.keyboard.press("Escape");

  await inspector(page).getByRole("tab", { name: "Opinion" }).click();
  const opinion = inspector(page).getByTestId("stage-opinion");
  await expect(opinion).toContainText("7 left on slide 8");
  await expect(opinion).toContainText("48 of 55 objects checked");
  await expect(opinion).toContainText("1 added");

  await inspector(page).getByRole("tab", { name: "Objects" }).click();
  const open = page.locator('[data-testid="stage-review-object"][data-decision=""]');
  await expect(open).toHaveCount(7);
  for (let left = 7; left > 0; left -= 1) {
    await open.first().locator('button[data-counts-as="agree"]').click();
    await expect(open).toHaveCount(left - 1);
  }
  await expect(progress.getByTestId("decision-ring")).toHaveAttribute("aria-label", /^100% done/);
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveAttribute("title", "Open the Slide done card in the Opinion tab");

  await bar(page).getByTestId("progress-trigger").click();
  await expect(popover).toContainText("55 of 55");
  await expect(popover).toContainText("Still open0");
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await expect(page.getByTestId("inspector-tab")).toBeVisible();
  await submit.click();
  await expect(page).toHaveURL(/tab=opinion/);
  await expect(opinion.getByRole("button", { name: "Submit" })).toBeVisible();
  await expect(opinion).toContainText("55 objects checked");
});

test("guided review checks Guided, and the account menu leads back to Parfocal home", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}`);
  await ready(page);
  await expect(modes(page)).toHaveText(["Guided", "Full viewer"]);
  await expect(modes(page).filter({ hasText: "Guided" })).toBeChecked();
  await expect(bar(page).getByTestId("slide-picker")).toHaveText("A1 · H&E");

  await bar(page).getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Parfocal home" }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(bar(page)).toHaveCount(0);
});

test("a slide opened without a task keeps Annotate, the tissue ring and its case facts", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH`);
  await ready(page);
  await expect(modes(page)).toHaveText(["Full viewer", "Annotate"]);
  await expect(bar(page).getByTestId("viewed-ring")).toBeVisible();
  await expect(bar(page).getByTestId("decision-ring")).toHaveCount(0);
  await expect(bar(page).getByTestId("case-header")).toContainText("result set");
  await expect(bar(page).getByRole("button", { name: "Submit" })).toHaveCount(0);
});
