import { expect, test } from "@playwright/test";
import { area, realTags, signIn, slidePairWithTiles } from "./real.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test(
  "compare opens from the tool rail, picks a second slide and draws both",
  realTags(area.viewer),
  async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "/my-work");
    const { project, left, right, rightLabel } = await slidePairWithTiles(page);
    await page.goto(`/projects/${project}/slides/${left}`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 45_000,
    });
    await page.getByTestId("rail-compare").click();
    await expect(page).toHaveURL(/scene=picking/);

    await page
      .getByRole("listbox", { name: "Slide for the right side" })
      .getByRole("option", { name: new RegExp(`^${escaped(rightLabel)}\\b`) })
      .first()
      .click();
    const pane = (side: string) => page.locator(`[data-pane="${side}"]`);
    for (const side of ["left", "right"]) {
      await expect(pane(side).getByTestId("still-engine")).toHaveAttribute("data-state", "ready", {
        timeout: 45_000,
      });
    }
    expect(await pane("left").getByTestId("still-engine").getAttribute("data-slide")).toEqual(left);
    expect(await pane("right").getByTestId("still-engine").getAttribute("data-slide")).toEqual(
      right,
    );
    await expect(page).toHaveURL(/scene=picked/);
    await expect(page.getByTestId("slide-progress")).toContainText("Comparing 2 slides");
    await expect(page.getByTestId("slide-progress")).not.toContainText("Opening");
  },
);
