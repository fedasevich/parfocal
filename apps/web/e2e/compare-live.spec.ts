import { expect, test } from "@playwright/test";
import { area, realTags, signIn, slidePairWithTiles } from "./real.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test(
  "compare opens from the tool rail, picks a second slide and draws both",
  realTags(area.viewer),
  async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, "/my-work");
    const { project, left, right, rightLabel } = await slidePairWithTiles(page);
    await page.goto(`/projects/${project}/slides/${left}`);
    const stage = page.getByTestId("slide-stage");
    await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
    await page.getByTestId("rail-compare").click();
    await expect(page).toHaveURL(/layout=compare/);

    await page
      .getByRole("listbox", { name: "Slide for the right side" })
      .getByRole("option", { name: new RegExp(`^${escaped(rightLabel)}\\b`) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`with=${right}`));
    const rightEngine = page.locator('[data-pane="right"]').getByTestId("still-engine");
    await expect(rightEngine).toHaveAttribute("data-slide", right);
    await expect(rightEngine).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
    await expect(stage).toHaveAttribute("data-pane", "left");
    await expect(stage).toHaveAttribute("data-state", "ready");
    await expect(page.locator("[data-compare]")).toHaveAttribute("data-compare", "drawn");
    expect(new URL(page.url()).pathname).toContain(left);
  },
);
