import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classColors,
  colorTokens,
  controlHeightsPx,
  countHeightPx,
  iconSizesPx,
  proposalColor,
  radiiPx,
  spaceUnitPx,
  spacingPx,
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
  assert.equal(shared.get("space-zone"), `${spacingPx.zone}px`);
  assert.equal(shared.get("space-in"), `${spacingPx.in}px`);
  assert.equal(shared.get("pad-zone"), `${spacingPx.padZone}px`);
  assert.equal(shared.get("pad-modal"), `${spacingPx.padModal}px`);
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
