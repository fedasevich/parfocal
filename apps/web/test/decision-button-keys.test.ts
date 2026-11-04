import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answersFor,
  type DecisionStyle,
  type ProjectClass,
} from "@parfocal/ui/lib/decision-answers";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { answerKeyIds } from "../src/screens/review/answer-keys.ts";
import { decisionKeyActions } from "../src/screens/review/decision-mapping.ts";

const classes: ProjectClass[] = [
  { name: "Tumor", color: "#f87171" },
  { name: "Stroma", color: "#6ee7b7" },
  { name: "Immune", color: "#c084fc" },
  { name: "Other", color: "#fbbf24" },
];

const styles: DecisionStyle[] = ["certainty", "agree", "yesno", "blind"];

const expectedKeys: Record<DecisionStyle, string[]> = {
  certainty: ["1", "2", "3", "4", "5"],
  agree: ["K", "X", "U"],
  yesno: ["Y", "N", "U"],
  blind: ["1", "2", "3", "4", "U"],
};

const bindingsOf = (style: DecisionStyle) =>
  keyRegistry.bindings({ scopes: ["review"], only: decisionKeyActions(style) });

for (const style of styles) {
  test(`the ${style} buttons show the keys of the key registry`, () => {
    const answers = answersFor(style, classes, "Tumor");
    const bindings = bindingsOf(style);
    for (const answer of answers) {
      assert.ok(answer.action, `${answer.raw} has an action`);
      const binding = bindings.find((entry) => entry.action === answer.action);
      assert.ok(binding, `${answer.action} is registered`);
      assert.deepEqual(binding.keys, [answer.key]);
    }
  });

  test(`the ${style} buttons match the keys of the style`, () => {
    const answers = answersFor(style, classes, "Tumor");
    assert.deepEqual(
      answers.map((answer) => answer.key),
      expectedKeys[style],
    );
    for (const id of answerKeyIds(answers))
      assert.ok(decisionKeyActions(style).includes(id), `${id} belongs to ${style}`);
  });
}

test("Not sure is offered in every style but 5-point certainty, which has Can't tell", () => {
  for (const style of ["agree", "yesno", "blind"] as const)
    assert.ok(answersFor(style, classes).some((answer) => answer.raw === "unsure"));
  assert.ok(answersFor("certainty").some((answer) => answer.label === "Can't tell"));
});

test("the blind style has one key per project class", () => {
  const answers = answersFor("blind", classes);
  assert.equal(answers.length, classes.length + 1);
  assert.deepEqual(
    answers.slice(0, -1).map((answer) => answer.raw),
    classes.map((entry) => entry.name),
  );
});

test("the keys of one style never collide", () => {
  for (const style of styles) {
    const keys = answersFor(style, classes).map((answer) => answer.key);
    assert.equal(new Set(keys).size, keys.length);
  }
});
