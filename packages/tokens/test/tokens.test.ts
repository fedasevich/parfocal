import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classColors,
  colorTokens,
  controlHeightsPx,
  countHeightPx,
  cubicBezierCss,
  densityMode,
  densitySpacingPx,
  effectiveMotionMode,
  iconSizesPx,
  motionDurationsMs,
  motionEasings,
  motionMs,
  proposalColor,
  radiiPx,
  spaceUnitPx,
  spacingPx,
  surfaceLevels,
  surfaceLevelTokens,
  surfaceSpacingPx,
  surfaceSpacingRulesPx,
  tagHeightPx,
  themedTokens,
  typeScale,
  unsureColor,
} from "../src/index.ts";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const entries = [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)];
  return new Map(entries.map((match) => [match[1] ?? "", (match[2] ?? "").trim()]));
}

const dark = block('[data-theme="dark"]');
const light = block('[data-theme="light"]');
const shared = block(":root");

test("every themed token has a dark and a light value", () => {
  for (const token of themedTokens) {
    assert.ok(dark.get(token), `${token} has no dark value`);
    assert.ok(light.get(token), `${token} has no light value`);
  }
});

test("each theme block holds only the themed tokens", () => {
  assert.deepEqual([...dark.keys()].sort(), [...themedTokens].sort());
  assert.deepEqual([...light.keys()].sort(), [...themedTokens].sort());
});

test("the token names DS-001 lists are all there", () => {
  for (const token of [
    "surf-page",
    "surf-panel",
    "surf-section",
    "surf-field",
    "chrome-3",
    "canvas",
    "line",
    "line-strong",
    "fg",
    "fg-dim",
    "fg-faint",
    "accent",
    "accent-fill",
    "ok",
    "warn",
    "bad",
    "research-fg",
    "v-agree",
    "v-disagree",
    "v-unsure",
    "v-open",
    "unsure",
  ]) {
    assert.ok((colorTokens as readonly string[]).includes(token), `${token} is missing`);
  }
});

test("class and proposal colours are the same in both themes", () => {
  for (const [name, value] of Object.entries(classColors)) {
    assert.equal(shared.get(`c-${name}`), value);
  }
  assert.equal(shared.get("c-prop"), proposalColor.stroke);
  assert.equal(shared.get("c-prop-casing"), proposalColor.casing);
});

test("unsure keeps the kit values", () => {
  assert.equal(dark.get("unsure"), unsureColor.dark);
  assert.equal(light.get("unsure"), unsureColor.light);
});

test("sizes match the constants", () => {
  assert.equal(shared.get("pad-small-modal"), `${spacingPx.padSmallModal}px`);
  assert.equal(shared.get("h-sm"), `${controlHeightsPx.sm}px`);
  assert.equal(shared.get("h-md"), `${controlHeightsPx.md}px`);
  assert.equal(shared.get("h-lg"), `${controlHeightsPx.lg}px`);
  assert.equal(shared.get("tag-h"), `${tagHeightPx}px`);
  assert.equal(shared.get("count-h"), `${countHeightPx}px`);
  for (const [size, px] of Object.entries(iconSizesPx)) {
    assert.equal(shared.get(`ic-${size}`), `${px}px`);
  }
});

test("the Tailwind theme has the nine type sizes", () => {
  for (const [style, { size, line }] of Object.entries(typeScale)) {
    assert.ok(theme.includes(`--text-${style}: ${size}px;`), `text-${style} is missing`);
    assert.ok(theme.includes(`--text-${style}--line-height: ${line}px;`));
  }
});

test("spacing and radii match the constants", () => {
  assert.equal(shared.get("space"), `${spaceUnitPx}px`);
  assert.equal(shared.get("r-sm"), `${radiiPx.sm}px`);
  assert.equal(shared.get("r-md"), `${radiiPx.md}px`);
  assert.equal(shared.get("r-lg"), `${radiiPx.lg}px`);
  assert.equal(shared.get("r-ctl"), `${radiiPx.ctl}px`);
  assert.equal(shared.get("r-zone"), `${radiiPx.zone}px`);
});

test("the Tailwind theme exposes every colour token", () => {
  for (const token of colorTokens) {
    assert.ok(
      theme.includes(`--color-${token}: var(--${token});`),
      `--color-${token} is not mapped`,
    );
  }
});

function motionBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

test("motion durations run from 120 to 400 ms and match the constants", () => {
  const body = motionBlock(":root,\n[data-motion]");
  const values = Object.values(motionDurationsMs);
  assert.equal(Math.min(...values), 120);
  assert.equal(Math.max(...values), 400);
  for (const [name, ms] of Object.entries(motionDurationsMs)) {
    assert.ok(body.includes(`--motion-${name}: calc(${ms}ms * var(--motion-scale));`), name);
  }
  for (const name of Object.keys(motionEasings)) {
    assert.ok(
      body.includes(
        `--motion-ease-${name}: ${cubicBezierCss(name as keyof typeof motionEasings)};`,
      ),
      name,
    );
  }
});

test("presenting runs at one third speed and reduced motion is a cut", () => {
  assert.match(motionBlock('[data-motion="presenting"]'), /--motion-scale: 3;/);
  assert.match(motionBlock('[data-motion="reduced"]'), /--motion-scale: 0;/);
  assert.equal(motionMs("slow", "presenting"), 900);
  assert.equal(motionMs("slower", "reduced"), 0);
  assert.equal(motionMs("fast"), 120);
  assert.equal(effectiveMotionMode("presenting", true), "reduced");
  assert.equal(effectiveMotionMode("presenting", false), "presenting");
});

test("the reduced motion query zeroes every transition and animation", () => {
  const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(media.length > 0);
  for (const rule of [
    "--motion-scale: 0;",
    "animation-duration: 0s !important;",
    "transition-duration: 0s !important;",
    "transition-delay: 0s !important;",
    "::view-transition-group(*)",
  ]) {
    assert.ok(media.includes(rule), rule);
  }
});

test("Tailwind transitions default to the motion tokens", () => {
  assert.ok(theme.includes("--default-transition-duration: var(--motion-fast);"));
  assert.ok(theme.includes("--default-transition-timing-function: var(--motion-ease-standard);"));
  assert.ok(theme.includes("--ease-standard: var(--motion-ease-standard);"));
});

test("every density spacing matches its CSS variable in both modes", () => {
  const comfortable = motionBlock(':root,\n[data-density="comfortable"]');
  const compact = motionBlock('[data-density="compact"]');
  for (const [name, px] of Object.entries(densitySpacingPx)) {
    assert.ok(comfortable.includes(`--density-${name}: ${px.comfortable}px;`), name);
    assert.ok(compact.includes(`--density-${name}: ${px.compact}px;`), name);
    assert.ok(px.compact < px.comfortable, name);
  }
  assert.equal(densityMode("compact"), "compact");
  assert.equal(densityMode(undefined), "comfortable");
});

test("zone spacing sits beside density and follows it in both modes", () => {
  const comfortable = motionBlock(':root,\n[data-density="comfortable"]');
  const compact = motionBlock('[data-density="compact"]');
  for (const [name, px] of Object.entries(surfaceSpacingPx)) {
    assert.ok(comfortable.includes(`--${name}: ${px.comfortable}px;`), name);
    assert.ok(compact.includes(`--${name}: ${px.compact}px;`), name);
    assert.equal(shared.get(name), undefined, `${name} is also in the shared block`);
  }
  assert.equal(spacingPx.zone, surfaceSpacingPx["space-zone"].comfortable);
  assert.equal(spacingPx.padModal, surfaceSpacingPx["pad-modal"].comfortable);
});

test("zone spacing keeps the surface rules in both modes", () => {
  for (const [name, rule] of Object.entries(surfaceSpacingRulesPx)) {
    for (const px of Object.values(surfaceSpacingPx[name as keyof typeof surfaceSpacingRulesPx])) {
      assert.ok(px >= rule.min && px <= rule.max, `${name} ${px}px is outside the rule`);
    }
  }
});

test("each surface level has its own colour in both themes", () => {
  assert.deepEqual([...surfaceLevels], ["page", "panel", "section", "highlight"]);
  for (const theme of [dark, light]) {
    const colours = surfaceLevels.map((level) => theme.get(surfaceLevelTokens[level]));
    assert.ok(colours.every(Boolean));
    assert.equal(new Set(colours).size, surfaceLevels.length);
  }
});
