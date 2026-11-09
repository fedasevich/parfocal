import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";

async function openReviewSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  return stage;
}

const layer = (page: Page) => page.getByTestId("outline-layer");
const modes = (page: Page) => page.getByRole("radiogroup", { name: "Outline display" });

test("each outline mode changes the overlay on a real slide and the choice is remembered", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openReviewSlide(page);
  await expect(layer(page)).toHaveAttribute("data-mode", "fade");
  await expect(layer(page)).toHaveAttribute("data-overlays", "1");
  expect(Number(await layer(page).getAttribute("data-outlines"))).toBeGreaterThan(0);
  const signatures = new Map<string, string>();
  signatures.set("fade", (await layer(page).getAttribute("data-signature")) ?? "");

  await modes(page).getByText("Bands").click();
  await expect(layer(page)).toHaveAttribute("data-mode", "bands");
  await expect(layer(page)).toHaveAttribute("data-overlays", "1");
  signatures.set("bands", (await layer(page).getAttribute("data-signature")) ?? "");

  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/me/setting-layers"),
  );
  await modes(page).getByText("Mark unsure").click();
  await expect(layer(page)).toHaveAttribute("data-mode", "mark-unsure");
  await expect(layer(page)).toHaveAttribute("data-overlays", "2");
  signatures.set("mark-unsure", (await layer(page).getAttribute("data-signature")) ?? "");

  expect(new Set(signatures.values()).size).toBe(3);

  await saved;
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(layer(page)).toHaveAttribute("data-mode", "mark-unsure");
  await expect(modes(page).getByRole("radio", { name: "Mark unsure" })).toBeChecked();
});

test("the Settings row sets the mode the viewer opens with", async ({ page }) => {
  await page.goto("/settings/ai");
  const row = modes(page);
  await row.getByText("Bands").click();
  await expect(row.getByRole("radio", { name: "Bands" })).toBeChecked();
  await openReviewSlide(page);
  await expect(layer(page)).toHaveAttribute("data-mode", "bands");
});
