import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHex, textLimits, wcagContrast } from "../src/colour-check.ts";
import { loadCheckInput } from "../tools/colour-sources.ts";

const input = loadCheckInput();

const quietTokens = ["fg-dim", "fg-faint"] as const;
const surfaces = [
  "page",
  "chrome",
  "chrome-2",
  "chrome-3",
  "surf-page",
  "surf-panel",
  "surf-section",
  "surf-field",
] as const;

for (const theme of ["light", "dark"] as const) {
  const tokens = input.themes[theme] as Record<string, string | undefined>;
  for (const quiet of quietTokens) {
    for (const surface of surfaces) {
      test(`${quiet} on ${surface} passes WCAG AA in the ${theme} theme`, () => {
        const text = tokens[quiet];
        const background = tokens[surface];
        assert.ok(text, `${quiet} is missing in the ${theme} theme`);
        assert.ok(background, `${surface} is missing in the ${theme} theme`);
        const ratio = wcagContrast(parseHex(text), parseHex(background));
        assert.ok(
          ratio >= textLimits.wcag,
          `${quiet} ${text} on ${surface} ${background} is ${ratio.toFixed(2)}, needs ${textLimits.wcag}`,
        );
      });
    }
  }
}
