import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apcaLc,
  check,
  ciede2000,
  closestClassPairUnder,
  formatFindings,
  parseHex,
  separation,
  simulate,
  wcagContrast,
} from "../src/colour-check.ts";
import { classColors, proposalColor, unsureColor } from "../src/index.ts";
import { cssBlock, loadCheckInput, readApiLimits, readPixels } from "../tools/colour-sources.ts";

const input = loadCheckInput();

function distance(
  first: string,
  second: string,
  vision: "protanopia" | "deuteranopia" | "tritanopia",
) {
  return ciede2000(simulate(parseHex(first), vision), simulate(parseHex(second), vision));
}

test("WCAG 2 contrast of black on white is 21", () => {
  assert.equal(wcagContrast(parseHex("#000000"), parseHex("#ffffff")), 21);
});

test("APCA lightness contrast is large for black on white and zero for equal colours", () => {
  assert.ok(apcaLc(parseHex("#000000"), parseHex("#ffffff")) > 100);
  assert.equal(apcaLc(parseHex("#777777"), parseHex("#777777")), 0);
});

test("CIEDE2000 after Machado simulation matches the POC script on the three closest pairs", () => {
  const { tumor, stroma, other } = classColors;
  assert.ok(Math.abs(distance(stroma, other, "protanopia") - 19.522852630682436) < 1e-9);
  assert.ok(Math.abs(distance(tumor, stroma, "deuteranopia") - 15.102366896894713) < 1e-9);
  assert.ok(Math.abs(distance(tumor, other, "tritanopia") - 17.188485235985873) < 1e-9);
});

test("the checked tokens equal the constants the package exports", () => {
  assert.deepEqual(input.classes, classColors);
  assert.equal(input.proposal, proposalColor.stroke);
  assert.equal(input.proposalCasing, proposalColor.casing);
  assert.equal(input.themes.dark.unsure, unsureColor.dark);
  assert.equal(input.themes.light.unsure, unsureColor.light);
});

test("the limits come from the API taxonomy check", () => {
  assert.equal(input.limits.betweenClasses, 15);
  assert.deepEqual(
    input.limits.reserved.map((mark) => [mark.label, mark.minDistance]),
    [
      ["unsure zones on the slide", 13],
      ["AI proposals", 40],
      ["unsure marks in the dark panel", 15],
      ["unsure marks in the light panel", 15],
    ],
  );
});

test("doc 35 baseline: the closest class pair is 15.1 under deuteranopia", () => {
  const pair = closestClassPairUnder(input.classes, "deuteranopia");
  assert.equal(pair.pair, "tumor and stroma");
  assert.equal(pair.distance.toFixed(1), "15.1");
  assert.equal(separation(classColors.tumor, classColors.stroma).vision, "deuteranopia");
});

test("doc 35 baseline: proposals are at least 40 and unsure marks 13 and 15 from every class", () => {
  const worst = (colour: string) =>
    Math.min(...Object.values(input.classes).map((cls) => separation(colour, cls).distance));
  assert.ok(worst(proposalColor.stroke) >= 40);
  assert.ok(worst(proposalColor.casing) >= 13);
  assert.ok(worst(unsureColor.dark) >= 15);
  assert.ok(worst(unsureColor.light) >= 15);
});

test("every colour threshold holds for the current tokens", () => {
  const failed = check(input).filter((finding) => !finding.pass);
  assert.deepEqual(failed, [], formatFindings(failed));
});

test("the sampled H&E pixels are present", () => {
  assert.ok(input.pixels.length > 1000);
});

test("a token change that breaks a threshold fails the check", () => {
  const nearTumor = { ...input.classes, stroma: "#f87d71" };
  assert.ok(check({ ...input, classes: nearTumor }).some((finding) => !finding.pass));

  const dimText = { ...input.themes.dark, "fg-faint": "#555555" };
  const broken = check({ ...input, themes: { ...input.themes, dark: dimText } });
  assert.ok(broken.some((finding) => !finding.pass && finding.group === "text"));

  const lightProposal = check({ ...input, proposal: "#f87172" });
  assert.ok(lightProposal.some((finding) => !finding.pass && finding.group === "marks"));
});

test("the token for a reserved mark must equal the API colour", () => {
  const drifted = check({
    ...input,
    themes: { ...input.themes, dark: { ...input.themes.dark, unsure: "#cbd5e2" } },
  });
  assert.ok(drifted.some((finding) => !finding.pass && finding.group === "limits"));
});

test("the loaders read the CSS blocks, the API limits and the pixel encoding", () => {
  assert.equal(cssBlock(":root{--a:#AABBCC;}", ":root").a, "#aabbcc");
  assert.equal(
    readApiLimits('MIN_BETWEEN_CLASSES = 12.5\nRESERVED = (\n    ("#ffffff", "x", 9.0),\n)')
      .reserved[0]?.minDistance,
    9,
  );
  assert.deepEqual(readPixels("ff000000ff00"), [
    [255, 0, 0],
    [0, 255, 0],
  ]);
});
