import { expect, test } from "./telemetry-capture.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const showcaseCase = "00000000-0000-4000-8004-000000000009";

test("the showcase case opens its signed report and its shared report link", async ({ page }) => {
  await page.goto(`/projects/${p03}/cases/${showcaseCase}/report`);
  const flow = page.getByTestId("clinical-report");
  await expect(flow.getByRole("heading", { name: "Clinical report" })).toBeVisible();
  await expect(flow.getByText(/signed/i).first()).toBeVisible();
  await page.goto("/shared-reports/showcase-shared-report");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByText(/revoked or has expired|not found/i)).toHaveCount(0);
});
