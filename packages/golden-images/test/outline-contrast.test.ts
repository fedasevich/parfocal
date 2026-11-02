import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classColors, defaultVectorStyles, nearBlack } from "@parfocal/viewer-engine";
import { contrastRatio, outlineContrast, relativeLuminance } from "#contrast.ts";
import { goldenPath } from "#golden.ts";
import { readPng } from "#png.ts";

const tissueViews = ["10x", "40x", "80x"].map((view) =>
  readPng(goldenPath(new URL("../goldens", import.meta.url).pathname, `viv-cmu-1-svs-${view}`)),
);

const maximumShare = 0.1;

test("black on white is 21:1 and a colour against itself is 1:1", () => {
  const black = relativeLuminance([0, 0, 0]);
  const white = relativeLuminance([255, 255, 255]);
  assert.equal(contrastRatio(white, black), 21);
  assert.equal(contrastRatio(white, white), 1);
});

test("the tissue frames are real H&E at 10x, 40x and 80x", () => {
  assert.equal(tissueViews.length, 3);
  for (const frame of tissueViews) assert.ok(frame.width * frame.height >= 100_000);
});

for (const [name, color] of Object.entries(classColors)) {
  test(`a ${name} outline with its casing stays under 3:1 on less than 10% of H&E pixels`, () => {
    const casing = defaultVectorStyles["human-annotations"].casing;
    assert.ok(casing);
    const result = outlineContrast(tissueViews, color, casing.color);
    assert.ok(result.bothBelow / result.pixels < maximumShare, JSON.stringify(result));
    assert.ok(result.lineBelow > result.bothBelow * 5, "the casing must do the work");
  });
}

test("every class outline needs its casing, since bare it fails on most tissue", () => {
  for (const color of Object.values(classColors)) {
    const result = outlineContrast(tissueViews, color, color);
    assert.ok(result.bothBelow / result.pixels > 0.5, JSON.stringify(result));
  }
});

test("an AI proposal reaches 3:1 on every H&E pixel through its dash or its casing", () => {
  const { lineColor, casing } = defaultVectorStyles["ai-proposals"];
  assert.ok(lineColor && casing);
  const result = outlineContrast(tissueViews, lineColor, casing.color);
  assert.equal(result.bothBelow, 0);
});

test("the nucleus and measurement casings use the same near-black as annotations", () => {
  const annotation = defaultVectorStyles["human-annotations"].casing;
  assert.deepEqual(defaultVectorStyles.nuclei.casing?.color, annotation?.color);
  assert.deepEqual(defaultVectorStyles.measurements.casing?.color, annotation?.color);
});

const mock = readFileSync(
  new URL("../../../docs/design/ux-mock/index.html", import.meta.url),
  "utf8",
);

function mockColor(token: string): readonly number[] {
  const match = new RegExp(`--${token}:\\s*#([0-9a-f]{6})`, "i").exec(mock);
  assert.ok(match?.[1], `the mock has no ${token}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

test("the class colours and the proposal ink are the mock's tokens", () => {
  for (const [name, color] of Object.entries(classColors)) {
    assert.deepEqual(color.slice(0, 3), mockColor(`c-${name}`), name);
  }
  assert.deepEqual(nearBlack.slice(0, 3), mockColor("c-prop"));
});
