import assert from "node:assert/strict";
import { test } from "node:test";
import {
  disagreeOptions,
  reasonDraft,
  savedReasonLabels,
  toggleReasonLabel,
} from "../src/screens/review/disagree-reasons.ts";
import { revertedReasons } from "../src/screens/review/note-model.ts";

const classes = [
  { id: "c1", name: "Tumor", color: "#f87171" },
  { id: "c2", name: "Stroma", color: "#6ee7b7" },
  { id: "c3", name: "Immune", color: "#c084fc" },
  { id: "c4", name: "Other", color: "#fbbf24" },
];

test("a region offers four reasons and names the AI class in the first", () => {
  const labels = disagreeOptions("region", "Tumor", classes).map((item) => item.label);
  assert.deepEqual(labels, [
    "Not tumor",
    "Boundary is off",
    "Two regions, not one",
    "Artefact or fold",
  ]);
  assert.equal(disagreeOptions("region", "Stroma", classes)[0]?.label, "Not stroma");
});

test("a cell offers four reasons with the two most likely other classes", () => {
  const options = disagreeOptions("cell", "Tumor", classes);
  assert.deepEqual(
    options.map((item) => item.label),
    ["Not a cell", "It is an immune cell", "It is stroma", "Artefact"],
  );
  assert.deepEqual(
    options.map((item) => item.code),
    ["not_a_cell", "wrong_class", "wrong_class", "artefact"],
  );
});

test("the AI class is never offered as the right class", () => {
  const labels = disagreeOptions("cell", "Immune", classes).map((item) => item.label);
  assert.ok(!labels.includes("It is an immune cell"));
  assert.equal(labels.length, 4);
});

test("a wrong class reason carries the chosen class", () => {
  const options = disagreeOptions("cell", "Tumor", classes);
  assert.deepEqual(reasonDraft(["It is stroma"], options), {
    reasons: ["wrong_class"],
    reason_class_id: "c2",
  });
});

test("region reasons carry codes and no class", () => {
  const options = disagreeOptions("region", "Tumor", classes);
  assert.deepEqual(reasonDraft(["Not tumor", "Boundary is off"], options), {
    reasons: ["not_class", "boundary_off"],
    reason_class_id: null,
  });
  assert.deepEqual(reasonDraft([], options), { reasons: [], reason_class_id: null });
});

test("ticking a cell type clears Not a cell, Artefact and the other cell type", () => {
  const options = disagreeOptions("cell", "Tumor", classes);
  assert.deepEqual(toggleReasonLabel(["Not a cell"], "It is stroma", options), ["It is stroma"]);
  assert.deepEqual(toggleReasonLabel(["Artefact"], "It is stroma", options), ["It is stroma"]);
  assert.deepEqual(toggleReasonLabel(["It is an immune cell"], "It is stroma", options), [
    "It is stroma",
  ]);
});

test("ticking Not a cell or Artefact clears the cell type but they stay together", () => {
  const options = disagreeOptions("cell", "Tumor", classes);
  assert.deepEqual(toggleReasonLabel(["It is stroma"], "Not a cell", options), ["Not a cell"]);
  assert.deepEqual(toggleReasonLabel(["Not a cell"], "Artefact", options), [
    "Not a cell",
    "Artefact",
  ]);
  assert.deepEqual(toggleReasonLabel(["Not a cell", "Artefact"], "Not a cell", options), [
    "Artefact",
  ]);
});

test("region reasons do not exclude each other", () => {
  const options = disagreeOptions("region", "Tumor", classes);
  assert.deepEqual(
    toggleReasonLabel(["Not tumor", "Boundary is off"], "Artefact or fold", options),
    ["Not tumor", "Boundary is off", "Artefact or fold"],
  );
});

test("saved codes come back as the chip labels the card shows", () => {
  const options = disagreeOptions("cell", "Tumor", classes);
  const fallback = (code: string) => `code:${code}`;
  assert.deepEqual(savedReasonLabels(["artefact"], null, options, fallback), ["Artefact"]);
  assert.deepEqual(savedReasonLabels(["wrong_class"], "c2", options, fallback), ["It is stroma"]);
  assert.deepEqual(savedReasonLabels(["wrong_class"], "c3", options, fallback), [
    "It is an immune cell",
  ]);
  assert.deepEqual(savedReasonLabels(["wrong_class"], "gone", options, fallback), [
    "code:wrong_class",
  ]);
  assert.deepEqual(savedReasonLabels(["need_ihc"], null, options, fallback), ["code:need_ihc"]);
});

test("a reverted reason set only goes back while the screen still shows the failed one", () => {
  const shown = { value: "disagree" as const, raw: "disagree", reasons: ["Artefact"], note: null };
  const answers = new Map([["C2", shown]]);
  const back = revertedReasons("C2", ["Artefact"], ["Not a cell"])(answers);
  assert.deepEqual(back.get("C2")?.reasons, ["Not a cell"]);
  const later = revertedReasons("C2", ["Not a cell"], [])(answers);
  assert.equal(later, answers);
});
