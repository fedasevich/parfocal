import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import type { TyperEvidence } from "@parfocal/ui/lib/confidence-words";
import { confidenceTints, scoreColour } from "@parfocal/viewer-engine";
import { bandTints, confidenceChip } from "../src/screens/review/ai-wording.ts";
import {
  belowCutoffDash,
  confidenceTintOf,
  type ObjectDrawSettings,
  objectStyle,
  scoreCss,
} from "../src/screens/viewer/object-draw.ts";

const region: ReviewObject = {
  object: "T1",
  kind: "region",
  number: 1,
  class_name: "Tumor",
  score: 0.92,
  size_mm: 3,
  other_class: null,
};

const faint: ReviewObject = { ...region, object: "T2", class_name: "Stroma", score: 0.25 };

const settings: ObjectDrawSettings = {
  draw: "outline",
  width: "2",
  opacity: 100,
  colorBy: "class",
  cutoff: 0,
};

const input = (change: Partial<ObjectDrawSettings> = {}, hidden: string[] = []) => ({
  settings: { ...settings, ...change },
  hiddenClasses: new Set(hidden),
  classColour: (name: string) => `var(--${name})`,
  decisionOf: (name: string) => (name === "T1" ? ("agree" as const) : undefined),
});

test("outline, fill, width and opacity reach the style", () => {
  const outline = objectStyle(region, input());
  assert.equal(outline.fill, undefined);
  assert.equal(outline.width, 2);
  assert.equal(outline.opacity, 1);
  assert.match(objectStyle(region, input({ draw: "fill" })).fill ?? "", /^color-mix/);
  assert.equal(objectStyle(region, input({ width: "3" })).width, 3);
  assert.equal(objectStyle(region, input({ opacity: 40 })).opacity, 0.4);
});

test("colour by class, score and decision", () => {
  assert.equal(objectStyle(region, input()).stroke, "var(--Tumor)");
  assert.equal(objectStyle(region, input({ colorBy: "score" })).stroke, scoreCss(0.92));
  assert.equal(objectStyle(region, input({ colorBy: "decision" })).stroke, "var(--v-agree)");
  assert.equal(objectStyle(faint, input({ colorBy: "decision" })).stroke, "rgb(190 190 190)");
});

test("an object under the cutoff draws dashed at half opacity and stays drawn", () => {
  const dimmed = objectStyle(faint, input({ cutoff: 0.5, opacity: 80 }));
  assert.equal(dimmed.dash, belowCutoffDash);
  assert.equal(dimmed.opacity, 0.4);
  assert.notEqual(dimmed.stroke, "none");
  const kept = objectStyle(region, input({ cutoff: 0.5 }));
  assert.equal(kept.dash, undefined);
  assert.equal(objectStyle(faint, input({ cutoff: 0 })).dash, undefined);
});

test("a hidden class draws nothing", () => {
  assert.equal(objectStyle(region, input({}, ["Tumor"])).stroke, "none");
  assert.notEqual(objectStyle(faint, input({}, ["Tumor"])).stroke, "none");
});

test("the web colours match the engine colours", () => {
  const rgb = (tint: readonly number[]) => `rgb(${tint.slice(0, 3).join(" ")})`;
  assert.equal(scoreCss(0.3), rgb(scoreColour(0.3)));
  for (const band of ["confident", "likely", "unsure", "doubtful"] as const) {
    assert.deepEqual([...bandTints[band]], [...confidenceTints[band].slice(0, 3)]);
  }
  assert.equal(confidenceTintOf(0.9), rgb(confidenceTints.confident));
  assert.equal(confidenceTintOf(0.3), rgb(confidenceTints.doubtful));
});

test("each confidence form gives the AI says line its own content", () => {
  assert.equal(confidenceChip(region, "number")?.form, "number");
  assert.equal(confidenceChip(region, "number")?.text, "92% sure");
  const measured: TyperEvidence = {
    name: "Measured typer",
    calibrated: true,
    checkedOnHeldOut: true,
    bandAccuracy: { confident: 0.93 },
  };
  assert.deepEqual(confidenceChip(region, "word", measured), {
    form: "word",
    text: "very sure",
    band: "confident",
  });
  assert.equal(confidenceChip(region, "color")?.form, "color");
  assert.equal(confidenceChip(region, "color")?.band, "confident");
  assert.equal(confidenceChip(region, "hidden"), null);
});
