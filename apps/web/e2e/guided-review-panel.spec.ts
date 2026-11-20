import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

const panel = (page: Page) => page.getByTestId("stage-review-objects");
const dot = (page: Page, object: string) =>
  panel(page).getByRole("group", { name: "Objects" }).getByRole("button", { name: object });

test("guided review has the mock's own panel and walks a slide to the done card", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  await expect(panel(page)).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await page.getByRole("button", { name: "Got it, start" }).click();
  await expect(page.getByRole("toolbar", { name: "Tools" })).toHaveCount(0);
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector.getByRole("tab")).toHaveText([/^Review/, /^Comments/, /^Display/]);
  await expect(page.getByTestId("guided-slide-chip")).toHaveAttribute(
    "title",
    /^Slide 8 of \d+\. Submit opens the next one$/,
  );
  await expect(panel(page)).toHaveAttribute("data-current", "T5");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(/T5/);
  await expect(panel(page).getByText(/^Object 5 of \d+ on this slide$/)).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Add something the AI missed" }),
  ).toBeVisible();
  await expect(dot(page, "T5")).toHaveAttribute("title", "T5, not answered yet");
  await page.keyboard.press("k");
  await expect(panel(page)).not.toHaveAttribute("data-current", "T5");
  await expect(dot(page, "T5")).toHaveAttribute("title", /^T5, agree/);
  const afterFirst = (await panel(page).getAttribute("data-current")) ?? "";
  await panel(page)
    .getByRole("button", { name: /Skip for now/ })
    .click();
  await expect(panel(page)).not.toHaveAttribute("data-current", afterFirst);
  await panel(page)
    .getByRole("button", { name: /Previous/ })
    .click();
  await expect(panel(page)).toHaveAttribute("data-current", afterFirst);
  for (let step = 0; step < 60; step += 1) {
    if (await page.getByTestId("stage-opinion").isVisible()) break;
    const at = (await panel(page).getAttribute("data-current")) ?? "";
    await page.keyboard.press("k");
    await expect
      .poll(async () => {
        const done = await page.getByTestId("stage-opinion").isVisible();
        return done ? "done" : panel(page).getAttribute("data-current");
      })
      .not.toBe(at);
  }
  await expect(inspector).toHaveAttribute("data-tab", "objects");
  const form = inspector.getByTestId("stage-opinion");
  await expect(form).toHaveAttribute("data-form-only", "true");
  await expect(form.getByRole("button", { name: /^Submit/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Submit/ })).toHaveCount(1);
});
