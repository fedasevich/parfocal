import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function insideStage(page: Page, testId: string) {
  return page.getByTestId(testId).evaluateAll((nodes) => {
    const stage = document.querySelector('[data-testid="slide-stage"]')?.getBoundingClientRect();
    if (stage === undefined) return -1;
    return nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.left >= stage.left &&
        box.right <= stage.right &&
        box.top >= stage.top &&
        box.bottom <= stage.bottom
      );
    }).length;
  });
}

test("RT-14 shows five region tags, a T6⁺ tag for the added region and one sampled cells chip, and the chip and Whole slide move the view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=review&as=LM`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 60_000 });

  const tags = page.getByTestId("region-tag");
  await expect(tags).toHaveCount(6);
  await expect(tags.last()).toHaveText("T6⁺");
  await expect(tags.first()).toHaveText("T1 97%");
  await expect.poll(() => insideStage(page, "region-tag")).toBe(6);
  const chip = page.getByTestId("sample-chip");
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("50 sampled cells");
  await expect(chip).toContainText(/\d+ decided, \d+ open/);
  await expect.poll(() => insideStage(page, "sample-chip")).toBe(1);
  await expect(page.getByTestId("whole-slide-button")).toHaveCount(0);
  await expect(page.getByTestId("result-set-toggle")).toHaveCount(0);
  await expect(stage.getByRole("button", { name: /PathoSAM/ })).toHaveCount(0);
  await expect(page.getByTestId("result-set-cells")).toHaveCount(0);
  const outlines = page.getByTestId("review-object-outlines");
  await expect(outlines).toHaveAttribute("data-objects", "5");

  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(outlines).toHaveAttribute("data-objects", "55");
  const whole = page.getByTestId("whole-slide-button");
  await expect(whole).toBeVisible();
  await expect(whole).toHaveText("Whole slide");

  await whole.click();
  await expect(whole).toHaveCount(0);
  await expect(page.getByTestId("sample-chip")).toHaveCount(1);
  await expect(outlines).toHaveAttribute("data-objects", "5");
});
