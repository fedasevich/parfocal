import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiWording,
  bandOf,
  confidenceWords,
  DEFAULT_WORDING,
  effectiveMode,
  shapeOf,
  type TypeCall,
  type TyperEvidence,
  unmeasuredTyper,
  wordingModeOf,
} from "../src/lib/confidence-words.ts";

const hoverNext: TyperEvidence = {
  name: "HoVer-NeXt",
  calibrated: true,
  checkedOnHeldOut: true,
  bandAccuracy: { confident: 0.95, likely: 0.72, unsure: 0.51, doubtful: 0.44 },
};

const otherTyper: TyperEvidence = {
  name: "Stricter typer",
  calibrated: true,
  checkedOnHeldOut: true,
  cutoffs: { confident: 0.9, likely: 0.7, unsure: 0.5 },
  bandAccuracy: { confident: 0.97, likely: 0.81 },
};

const unmeasured: TyperEvidence = {
  name: "New typer",
  calibrated: false,
  checkedOnHeldOut: false,
  bandAccuracy: {},
};

const call = (tumor: number, immune: number, other = 1 - tumor - immune): TypeCall[] => [
  { label: "immune", probability: immune },
  { label: "tumor", probability: tumor },
  { label: "stroma", probability: other },
];

test("the four bands split at 80, 55 and 40", () => {
  assert.equal(bandOf(0.8), "confident");
  assert.equal(bandOf(0.7999), "likely");
  assert.equal(bandOf(0.55), "likely");
  assert.equal(bandOf(0.5499), "unsure");
  assert.equal(bandOf(0.4), "unsure");
  assert.equal(bandOf(0.3999), "doubtful");
});

test("plain words give the validated phrases", () => {
  const plain = (calls: TypeCall[]) => confidenceWords(calls, "plain", hoverNext).text;
  assert.equal(plain(call(0.9, 0.05)), "tumor");
  assert.equal(plain(call(0.72, 0.2)), "probably tumor");
  assert.equal(plain(call(0.47, 0.3)), "possibly tumor");
  assert.equal(plain(call(0.48, 0.42)), "tumor or immune");
  assert.equal(plain(call(0.36, 0.34)), "unclear, perhaps tumor or immune");
});

test("a close pair needs the top two within 10 points", () => {
  assert.equal(shapeOf(call(0.6, 0.5, 0)), "close");
  assert.equal(shapeOf(call(0.6, 0.4, 0)), "likely");
  assert.equal(shapeOf(call(0.39, 0.38)), "doubtful");
  assert.equal(shapeOf([{ label: "tumor", probability: 0.6 }]), "likely");
});

test("percent quotes the calibrated top and the runner up only when close", () => {
  const percent = (calls: TypeCall[]) => confidenceWords(calls, "percent", hoverNext).text;
  assert.equal(percent(call(0.72, 0.2)), "tumor 72%");
  assert.equal(percent(call(0.48, 0.42)), "tumor 48% or immune 42%");
  assert.equal(percent(call(0.36, 0.34)), "tumor 36% or immune 34%");
});

test("frequency quotes the band accuracy the typer measured", () => {
  const frequency = (calls: TypeCall[], typer = hoverNext) =>
    confidenceWords(calls, "frequency", typer).text;
  assert.equal(frequency(call(0.9, 0.05)), "tumor, right about 10 in 10 times");
  assert.equal(frequency(call(0.72, 0.2)), "tumor, right about 7 in 10 times");
  assert.equal(frequency(call(0.47, 0.3)), "tumor, right about 5 in 10 times");
  assert.equal(frequency(call(0.6, 0.3), otherTyper), "tumor, not measured at this confidence");
});

test("cutoffs are read per typer", () => {
  const words = confidenceWords(call(0.85, 0.1), "plain", otherTyper);
  assert.equal(words.band, "likely");
  assert.equal(words.text, "probably tumor");
  assert.equal(
    confidenceWords(call(0.85, 0.1), "frequency", otherTyper).text,
    "tumor, right about 8 in 10 times",
  );
  assert.equal(confidenceWords(call(0.85, 0.1), "plain", hoverNext).text, "tumor");
});

test("a typer without held out evidence falls back to percent", () => {
  assert.equal(effectiveMode("plain", unmeasured), "percent");
  assert.equal(effectiveMode("frequency", unmeasured), "percent");
  assert.equal(effectiveMode("plain", { ...hoverNext, checkedOnHeldOut: false }), "percent");
  const words = confidenceWords(call(0.9, 0.05), "plain", unmeasured);
  assert.equal(words.mode, "percent");
  assert.equal(words.text, "tumor 90%");
});

test("plain is the default and stays plain for a checked typer", () => {
  assert.equal(DEFAULT_WORDING, "plain");
  assert.equal(effectiveMode(DEFAULT_WORDING, hoverNext), "plain");
});

test("an empty call is refused", () => {
  assert.throws(() => confidenceWords([], "plain", hoverNext));
});

test("each wording setting maps to a mode, colour and hidden to none", () => {
  assert.equal(wordingModeOf("words"), "plain");
  assert.equal(wordingModeOf("numbers"), "percent");
  assert.equal(wordingModeOf("frequency"), "frequency");
  assert.equal(wordingModeOf("colour"), null);
  assert.equal(wordingModeOf("hidden"), null);
});

test("the AI wording follows the setting and falls back to percent for an uncalibrated typer", () => {
  const calls = call(0.72, 0.2);
  assert.equal(aiWording(calls, "words", hoverNext).text, "probably tumor");
  assert.equal(aiWording(calls, "numbers", hoverNext).text, "tumor 72%");
  assert.equal(aiWording(calls, "frequency", hoverNext).text, "tumor, right about 7 in 10 times");
  assert.deepEqual(aiWording(calls, "colour", hoverNext), {
    setting: "colour",
    mode: null,
    band: "likely",
    text: "tumor",
  });
  assert.equal(aiWording(calls, "hidden", hoverNext).text, null);
  for (const setting of ["words", "frequency"] as const) {
    const shown = aiWording(calls, setting, unmeasuredTyper("New typer"));
    assert.deepEqual([shown.mode, shown.text], ["percent", "tumor 72%"]);
  }
});
