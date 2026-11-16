import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const outlined = "00000000-0000-4000-8005-000000000004";

test.use({ viewport: { width: 1280, height: 900 } });

const leadArea = (page: Page) => page.locator("[data-slot=findings-area]").first();

test("measuring the lead area pre-draws the ruler, replaces the AI size and settles the hero", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${outlined}?task=${rt14}`);
  const staging = page.locator("[data-slot=staging-cards]");
  await expect(staging).toHaveAttribute("data-phase", "open", { timeout: 20_000 });
  await expect(page.locator("[data-slot=findings-panel]")).toHaveAttribute(
    "data-layout",
    "node-staging",
  );
  const lead = leadArea(page);
  await lead.getByRole("button", { name: /^Area 1/ }).click();
  await lead
    .getByRole("group", { name: "Your call on area 1" })
    .getByRole("button", { name: /^Tumor/ })
    .click();
  await lead.getByRole("button", { name: "Measure it" }).click();
  await expect(page).toHaveURL(/tool=ruler/);
  await expect(page).toHaveURL(/across=R1/);
  const ruler = page.locator("[data-slot=ruler-line]");
  await expect(ruler).toHaveAccessibleName("Measured 2.10 mm");
  const sizeStep = lead.locator("[data-step=size]");
  await expect(sizeStep).toHaveAttribute("data-done", "true");
  await expect(lead.locator("[data-slot=size-check]")).toHaveAttribute("data-check", "within");
  await expect(staging).toHaveAttribute("data-phase", "settled");

  const end = page.getByRole("button", { name: "End of the ruler" });
  const box = await end.boundingBox();
  if (box === null) throw new Error("the ruler end has no box");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const start = await page.getByRole("button", { name: "Start of the ruler" }).boundingBox();
  if (start === null) throw new Error("the ruler start has no box");
  const away = {
    x: from.x + (from.x - (start.x + start.width / 2)) * 0.5,
    y: from.y + (from.y - (start.y + start.height / 2)) * 0.5,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 5 });
  await page.mouse.up();
  await expect(ruler).toHaveAccessibleName(/^Measured 3\.1\d mm$/);
  await expect(lead.locator("[data-slot=size-check]")).toHaveAttribute("data-check", "above");
  await expect(lead.getByText(/^Larger than the AI's likely range/)).toBeVisible();
  await expect(lead).toContainText("3.1");
  await expect(staging).toHaveAttribute("data-phase", "settled");
});
