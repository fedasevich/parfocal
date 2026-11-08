import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import {
  chosenType,
  typeAnswers,
  typeChoice,
  typeOptions,
} from "../src/screens/review/type-bar.ts";

const cell = { object: "T1·C1", kind: "cell", class_name: "Tumor", score: 0.6 } as ReviewObject;
const blind = { kind: "blind", agreeFrom: 4, disagreeTo: 2, question: null } as const;
const agree = { kind: "agree", agreeFrom: 4, disagreeTo: 2, question: null } as const;
const classes = [
  { name: "Tumor", color: "#f00", id: "c1" },
  { name: "Stroma", color: "#0f0", id: "c2" },
  { name: "Immune", color: "#00f", id: "c3" },
  { name: "Other", color: "#ff0", id: "c4" },
];
const option = (id: string) => {
  const found = typeOptions.find((item) => item.id === id);
  assert.ok(found);
  return found;
};

test("the bar holds Keep, the four types and Not a cell on K, 1 to 4 and X", () => {
  assert.deepEqual(
    typeOptions.map((item) => [item.label, item.key]),
    [
      ["Keep", "K"],
      ["Tumor", "1"],
      ["Stroma", "2"],
      ["Immune", "3"],
      ["Other", "4"],
      ["Not a cell", "X"],
    ],
  );
  assert.ok(typeAnswers.some((item) => item.raw === "unsure"));
});

test("the hover wording names what each type covers", () => {
  assert.match(option("Immune").hint, /neutrophils and eosinophils/);
  assert.match(option("Tumor").hint, /mitoses included/);
  assert.match(option("notcell").hint, /red blood cells/);
});

test("Keep agrees and the AI's own type agrees", () => {
  assert.equal(typeChoice(blind, option("keep"), cell, classes).value, "agree");
  assert.equal(typeChoice(blind, option("Tumor"), cell, classes).value, "agree");
});

test("another type disagrees and names the class", () => {
  const choice = typeChoice(blind, option("Immune"), cell, classes);
  assert.equal(choice.value, "disagree");
  assert.equal(choice.raw, "Immune");
  assert.deepEqual(choice.draft, { reasons: ["wrong_class"], reason_class_id: "c3" });
});

test("Not a cell disagrees with its reason in every style", () => {
  for (const style of [blind, agree]) {
    const choice = typeChoice(style, option("notcell"), cell, classes);
    assert.equal(choice.value, "disagree");
    assert.deepEqual(choice.reasons, ["Not a cell"]);
  }
});

test("the pressed button follows the saved answer", () => {
  const choice = typeChoice(blind, option("Stroma"), cell, classes);
  assert.equal(chosenType(blind, cell, classes, choice), "Stroma");
  assert.equal(chosenType(blind, cell, classes, undefined), undefined);
});
