import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { isTagHeightInSet, isTagToneInSet, type TagSlot, tagSlots } from "../src/lib/tag-sets.ts";

type StoryIndex = {
  entries: Record<string, { id: string; type: "story" | "docs" }>;
};

const index = JSON.parse(
  readFileSync(new URL("../storybook-static/index.json", import.meta.url), "utf8"),
) as StoryIndex;

const stories = Object.values(index.entries).filter((entry) => entry.type === "story");

const toneAttribute: Record<string, string> = {
  "status-tag": "data-tone",
  "category-tag": "data-tone",
  "result-set-tag": "data-source",
};

const selector = tagSlots.map((slot) => `[data-slot="${slot}"]`).join(",");

for (const theme of ["dark"] as const) {
  for (const story of stories) {
    test(`${story.id} keeps every tag to its height and tone`, async ({ page }) => {
      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`,
      );
      await page.locator("#storybook-root > *").first().waitFor();
      const tags = await page.locator(selector).evaluateAll((elements, attributes) => {
        return elements.map((element) => {
          const slot = element.getAttribute("data-slot") ?? "";
          const attribute = attributes[slot];
          return {
            slot,
            text: element.textContent ?? "",
            height: element.getBoundingClientRect().height,
            tone: attribute ? element.getAttribute(attribute) : null,
          };
        });
      }, toneAttribute);
      const outside = tags.filter(
        (tag) =>
          !isTagHeightInSet(tag.slot as TagSlot, tag.height) ||
          !isTagToneInSet(tag.slot as TagSlot, tag.tone),
      );
      expect(outside).toEqual([]);
    });
  }
}

test("the tag stories show every type, tone and size", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=components-tags--every-type-and-tone-in-both-themes&viewMode=story&globals=a11y.manual:!true",
  );
  for (const theme of ["dark", "light"]) {
    const panel = page.locator(`[data-theme="${theme}"]`).last();
    for (const tone of ["neutral", "accent", "ok", "warn", "bad", "research"]) {
      await expect(panel.locator(`[data-slot="status-tag"][data-tone="${tone}"]`)).toHaveCount(1);
    }
    for (const source of ["imported", "run", "reviewed"]) {
      await expect(
        panel.locator(`[data-slot="result-set-tag"][data-source="${source}"]`),
      ).toHaveCount(1);
    }
    await expect(panel.locator('[data-slot="category-tag"]')).toHaveCount(2);
    await expect(panel.locator('[data-slot="object-id-tag"][data-size="md"]')).toHaveCount(1);
    await expect(panel.locator('[data-slot="object-id-tag"][data-size="lg"]')).toHaveCount(1);
    await expect(panel.locator('[data-slot="count-badge"]')).toHaveCount(2);
    await expect(panel.locator('[data-slot="filter-chip"]')).toHaveCount(2);
  }
});

test("a status tag always has its dot and a word", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=components-tags--status-tags&viewMode=story&globals=a11y.manual:!true",
  );
  const tags = page.locator('[data-slot="status-tag"]');
  await expect(tags).toHaveCount(6);
  for (const tag of await tags.all()) {
    await expect(tag.locator("i")).toHaveCount(1);
    await expect(tag).toHaveText(/\S/);
  }
});

test("tags are not buttons or links", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=components-tags--every-type-and-tone-in-both-themes&viewMode=story&globals=a11y.manual:!true",
  );
  for (const slot of [
    "status-tag",
    "category-tag",
    "object-id-tag",
    "result-set-tag",
    "count-badge",
  ]) {
    const cursors = await page
      .locator(`[data-slot="${slot}"]`)
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).cursor));
    expect(new Set(cursors)).not.toContain("pointer");
  }
});
