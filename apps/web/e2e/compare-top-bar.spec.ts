import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

test("compare opened from the rail keeps the review mode's top bar, rail and tabs", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=review`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const inspector = page.getByTestId("stage-inspector");
  const tabsBefore = await inspector.getByRole("tab").allInnerTexts();
  const railBefore = await page.locator("[data-slot='tool-rail-button']").count();
  await page.getByTestId("rail-compare").click();
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page).toHaveURL(/mode=review/);
  const bar = page.getByTestId("live-top-bar");
  await expect(bar.getByRole("link", { name: "My work" })).toBeVisible();
  await expect(bar.getByTestId("slide-picker")).toHaveText("A1 · H&E");
  await expect(bar.getByTestId("mode-switch").getByRole("radio")).toHaveText([
    "Guided",
    "Review",
    "Annotate",
  ]);
  await expect(page.getByRole("listbox", { name: "Slide for the right side" })).toBeVisible();
  expect(await inspector.getByRole("tab").allInnerTexts()).toEqual(tabsBefore);
  await expect(page.locator("[data-slot='tool-rail-button']")).toHaveCount(railBefore);

  await inspector.getByRole("tab", { name: /^Comments/ }).click();
  await expect(page).toHaveURL(/tab=comments/);
  await expect(page).toHaveURL(/layout=compare/);

  await bar.getByTestId("mode-switch").getByRole("radio", { name: "Annotate" }).click();
  await expect(page).toHaveURL(/mode=annotate/);
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-workspace", "annotate");
  await bar.getByTestId("mode-switch").getByRole("radio", { name: "Review" }).click();
  await expect(page).toHaveURL(/mode=review/);
  await expect(page).toHaveURL(/layout=compare/);
});

test("an old picking address opens the compare layout with the right side picker", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&scene=picking`);
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page).not.toHaveURL(/scene=/);
  const pill = page.locator('[data-slot="floating-pill"]');
  await expect(pill).toBeVisible();
  expect((await pill.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  await expect(page.getByRole("listbox", { name: "Slide for the right side" })).toBeVisible();
  await page.getByRole("button", { name: "Compare options" }).click();
  await expect(page.getByRole("button", { name: "Swap sides" })).toBeVisible();
});

test("an old picked address keeps the chosen right slide", async ({ page }) => {
  test.setTimeout(90_000);
  const a2 = "00000000-0000-4000-8005-000000000002";
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&scene=picked&with=${a2}`);
  await expect(page).toHaveURL(new RegExp(`layout=compare.*with=${a2}|with=${a2}.*layout=compare`));
  await expect(page.locator('[data-pane="right"]')).toHaveAccessibleName(/^Right: A2/);
});
