import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

type StoryIndex = {
  entries: Record<string, { id: string; type: "story" | "docs"; title: string }>;
};

const index = JSON.parse(
  readFileSync(new URL("../storybook-static/index.json", import.meta.url), "utf8"),
) as StoryIndex;

const stories = Object.values(index.entries).filter((entry) => entry.type === "story");

const baseUiFocusGuards = "[data-base-ui-focus-guard]";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test("the catalogue holds a story for every control in ADR 0130", () => {
  const titles = new Set(stories.map((story) => story.title));
  for (const control of [
    "Button",
    "Toggle group",
    "Switch",
    "Popover",
    "Dialog",
    "Dropdown menu",
    "Tabs",
    "Slider",
    "Select",
    "Combobox",
    "Tooltip",
  ]) {
    expect(titles).toContain(`Controls/${control}`);
  }
});

for (const theme of ["dark", "light"] as const) {
  for (const story of stories) {
    test(`${story.id} passes axe in ${theme}`, async ({ page }) => {
      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`,
      );
      await page.locator("#storybook-root > *").first().waitFor();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() =>
        Promise.race([
          Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]),
      );
      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .exclude(baseUiFocusGuards)
        .analyze();
      const violations = results.violations.map((violation) => ({
        rule: violation.id,
        targets: violation.nodes.map((node) => node.target.join(" ")),
        summary: violation.nodes[0]?.failureSummary,
      }));
      expect(violations).toEqual([]);
    });
  }
}
