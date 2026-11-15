import { expect, test } from "./a11y.ts";

test("the lab dashboard shows corrections per hundred nuclei by month from seeded data", async ({
  page,
}) => {
  await page.goto("/kpi");
  await expect(page.getByTestId("corrections-card")).toBeVisible();
  await expect(page.getByTestId("corrections-2026-06").getByTestId("corrections-value")).toHaveText(
    "23.0",
  );
  await expect(page.getByTestId("corrections-2026-11").getByTestId("corrections-value")).toHaveText(
    "11.0",
  );
});
