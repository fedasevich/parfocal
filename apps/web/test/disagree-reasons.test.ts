import assert from "node:assert/strict";
import { test } from "node:test";
import { disagreeOptions, reasonDraft } from "../src/screens/review/disagree-reasons.ts";

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
