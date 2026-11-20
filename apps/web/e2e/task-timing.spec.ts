import { expect, test } from "./a11y.ts";
import { area, ok, realTags, signIn } from "./real.ts";

test(
  "the task timing page shows timing events recorded through the API",
  realTags(area.admin),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const recorded = await ok<{ recorded: number }>(page, "POST", "/api/me/timing-events", {
      events: [
        { name: "task_finished", task_kind: "review", duration_ms: 540_000 },
        { name: "cell_review_timed", duration_ms: 4_000 },
      ],
    });
    expect(recorded.recorded).toBe(2);

    await page.goto("/kpi");
    await expect(page.getByTestId("kpi-source")).toHaveAttribute("data-source", "recorded");
    const review = page.getByTestId("kpi-review");
    await expect(review.getByRole("cell").nth(1)).not.toHaveText("0");
    await expect(review.getByRole("cell").nth(2)).not.toHaveText("No data");
    await expect(page.getByTestId("kpi-cell").getByRole("cell").nth(2)).not.toHaveText("No data");
  },
);
