import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodePng,
  diffFrame,
  type Frame,
  goldenUpdateRequested,
  isBootstrapping,
  judgeVisual,
  readPng,
  staleBaselines,
  UI_DENSITIES,
  UI_THEMES,
  UI_TOLERANCE,
  type UiDensity,
  VISUAL_APPROVE_COMMAND,
  visualCase,
  visualCases,
  writePng,
} from "@parfocal/golden-images";
import { expect, test } from "@playwright/test";

type StoryIndex = {
  entries: Record<string, { id: string; type: "story" | "docs" }>;
};

const index = JSON.parse(
  readFileSync(new URL("../storybook-static/index.json", import.meta.url), "utf8"),
) as StoryIndex;

const unstable: Record<string, string> = {};

const storyIds = Object.values(index.entries)
  .filter((entry) => entry.type === "story" && !(entry.id in unstable))
  .map((entry) => entry.id)
  .sort();

const baselineDirectory = fileURLToPath(new URL("../visual", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../test-results/visual", import.meta.url));
const baselinePath = (name: string) => join(baselineDirectory, `${name}.png`);

const existing = new Set(
  existsSync(baselineDirectory)
    ? readdirSync(baselineDirectory)
        .filter((file) => file.endsWith(".png"))
        .map((file) => file.slice(0, -4))
    : [],
);

const update = goldenUpdateRequested();

test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });

test("every committed UI baseline belongs to a story", () => {
  const stale = staleBaselines(visualCases(storyIds), existing);
  if (update) {
    for (const name of stale) {
      rmSync(baselinePath(name));
    }
    return;
  }
  test.skip(isBootstrapping(existing), `No UI baselines yet. Run ${VISUAL_APPROVE_COMMAND}`);
  expect(stale, `Remove these baselines or approve with ${VISUAL_APPROVE_COMMAND}`).toEqual([]);
});

for (const storyId of storyIds) {
  for (const theme of UI_THEMES) {
    test(`${storyId} looks as approved in ${theme} @visual`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-03-02T09:30:00Z"));
      const shots: Partial<Record<UiDensity, Frame>> = {};
      const failures: string[] = [];
      for (const density of UI_DENSITIES) {
        await page.goto(
          `/iframe.html?id=${storyId}&viewMode=story&globals=theme:${theme};density:${density};a11y.manual:!true`,
        );
        await page.locator("#storybook-root > *").first().waitFor();
        await page.waitForFunction(
          ([wantedTheme, wantedDensity]) => {
            const root = document.documentElement;
            return (
              root.getAttribute("data-theme") === wantedTheme &&
              root.getAttribute("data-density") === wantedDensity
            );
          },
          [theme, density],
        );
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const actual = decodePng(
          await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" }),
        );
        const item = visualCase(storyId, theme, density);
        const judgement = judgeVisual({
          item,
          actual,
          existing,
          readBaseline: (name) => readPng(baselinePath(name)),
          update,
          ...(shots.comfortable === undefined ? {} : { comfortableActual: shots.comfortable }),
        });
        shots[density] = actual;
        switch (judgement.status) {
          case "skipped":
            test.skip(true, judgement.reason);
            return;
          case "matched":
            break;
          case "missing":
            failures.push(judgement.message);
            break;
          case "differs": {
            const actualPath = join(outputDirectory, `${item.name}.actual.png`);
            const diffPath = join(outputDirectory, `${item.name}.diff.png`);
            mkdirSync(outputDirectory, { recursive: true });
            writePng(actualPath, actual);
            writePng(
              diffPath,
              diffFrame(actual, readPng(baselinePath(judgement.baseline)), UI_TOLERANCE),
            );
            failures.push(`${judgement.message}\nActual: ${actualPath}\nDiff: ${diffPath}`);
            break;
          }
          case "write":
            writePng(baselinePath(judgement.name), actual);
            break;
          case "same-as-comfortable":
            if (judgement.remove !== null) {
              rmSync(baselinePath(judgement.remove));
            }
            break;
        }
      }
      expect(failures, failures.join("\n\n")).toEqual([]);
    });
  }
}
