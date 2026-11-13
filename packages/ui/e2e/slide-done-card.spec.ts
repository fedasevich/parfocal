import { expect, type Page, test } from "@playwright/test";

const open = (page: Page, name: string) =>
  page.goto(
    `/iframe.html?id=patterns-app-patterns--${name}&viewMode=story&globals=a11y.manual:!true`,
  );
const card = (page: Page) => page.locator('[data-slot="slide-done-card"]');

test("the counts read in one line with the added objects", async ({ page }) => {
  await open(page, "slide-done-every-kind");
  await expect(card(page)).toContainText("Slide 8 is done");
  await expect(card(page)).toContainText(
    "55 objects checked: 38 agree, 11 disagree, 6 not sure. 1 added.",
  );
});

test("a card with open objects counts what is left", async ({ page }) => {
  await open(page, "slide-done-blockers");
  await expect(card(page)).toContainText("4 left on slide 8");
  await expect(card(page)).toContainText("51 of 55 objects checked");
});

test("the Required mark sits next to the required questions only", async ({ page }) => {
  await open(page, "slide-done-every-kind");
  const row = (text: string) => card(page).locator("div.grid.gap-2").filter({ hasText: text });
  await expect(row("How useful was the AI")).toContainText("Required");
  await expect(row("Would you sign this")).toContainText("Required");
  await expect(row("What made it hard?")).not.toContainText("Required");
  await expect(row("Anything else?")).not.toContainText("Required");
  await expect(card(page).getByText("Required", { exact: true })).toHaveCount(2);
});

test("each question kind takes an answer and keeps it", async ({ page }) => {
  await open(page, "slide-done-every-kind");
  const scale = card(page).getByRole("radio", { name: "4" });
  await scale.click();
  await expect(scale).toBeChecked();
  const chip = card(page).getByRole("button", { name: "Faint staining" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const yes = card(page).getByRole("radio", { name: "Yes" });
  await yes.click();
  await expect(yes).toBeChecked();
  const text = card(page).getByRole("textbox", { name: "Anything else?" });
  await text.fill("Fold near T2");
  await expect(text).toHaveValue("Fold near T2");
  await expect(scale).toBeChecked();
});

test("the scale shows its end labels", async ({ page }) => {
  await open(page, "slide-done-every-kind");
  await expect(card(page)).toContainText("1 not at all · 5 very");
});

test("one open object names itself on the disabled submit", async ({ page }) => {
  await open(page, "slide-done-one-blocker");
  const submit = card(page).getByRole("button", { name: /^Submit and open slide 9/ });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(/T5 is still open/);
});

test("several blockers each get a Go to link and the question one moves focus", async ({
  page,
}) => {
  await open(page, "slide-done-blockers");
  for (const name of ["Go to T5", "Go to the cells", "Go to the question"]) {
    await expect(card(page).getByRole("button", { name })).toBeVisible();
  }
  await expect(card(page).getByRole("button", { name: /^Submit and open slide 9/ })).toBeDisabled();
  await card(page).getByRole("button", { name: "Go to the question" }).click();
  await expect(card(page).locator('[data-question="q1"]')).toBeFocused();
});

test("a failed submit says nothing was lost and offers Try again", async ({ page }) => {
  await open(page, "slide-done-failed");
  await expect(card(page)).toContainText(
    "The review could not be submitted. Nothing was lost, every decision is saved.",
  );
  await expect(card(page).getByRole("button", { name: /^Try again/ })).toBeEnabled();
});

test("at panel width the card fits without a sideways scroll", async ({ page }) => {
  await open(page, "slide-done-panel-width");
  await expect(card(page)).toHaveAttribute("data-panel", "true");
  const fits = await card(page).evaluate((node) => node.scrollWidth <= node.clientWidth);
  expect(fits).toBe(true);
  const submit = card(page).getByRole("button", { name: /^Submit and open slide 9/ });
  await expect(submit).toBeVisible();
  const box = await submit.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(340);
});
