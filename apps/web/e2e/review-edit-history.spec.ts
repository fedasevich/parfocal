import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const square = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [9, 0],
      [9, 9],
      [0, 0],
    ],
  ],
};

test.use({ viewport: { width: 1440, height: 900 } });

test("the object card lists every review edit after the AI original", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(
    ({ key, shape }) => {
      if (sessionStorage.getItem("parfocal.fake.review-edit-history") !== null) return;
      const step = (change: string, at: string, geometry: unknown, deleted = false) => ({
        object: "T5",
        change,
        class_id: null,
        class_name: null,
        geometry,
        deleted,
        related: change === "cleared" ? ["T5"] : [],
        reviewer_id: null,
        changed_at: at,
      });
      sessionStorage.setItem(
        "parfocal.fake.review-edit-history",
        JSON.stringify({
          [key]: [
            step("edited", "2026-11-20T09:00:00Z", shape),
            step("edited", "2026-11-20T09:05:00Z", shape, true),
            step("cleared", "2026-11-20T09:10:00Z", null),
          ],
        }),
      );
    },
    { key: `${rt14}/${a1}:T5`, shape: square },
  );
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await page.getByRole("button", { name: "Got it, start" }).click();
  await expect(panel).toHaveAttribute("data-current", "T5");
  const history = panel.getByTestId("object-edit-history");
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await expect(history.getByRole("listitem").first()).toHaveAttribute("data-change", "ai-original");
  await expect(history.getByRole("listitem").nth(1)).toContainText("Changed");
  await expect(history.getByRole("listitem").nth(1)).toContainText("new outline");
  await expect(history.getByRole("listitem").nth(2)).toContainText("Deleted");
  await expect(history.getByRole("listitem").nth(2)).not.toContainText("new outline");
  await expect(history.getByRole("listitem").nth(3)).toContainText("Back to the AI original");
});
