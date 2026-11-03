import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionAnswer } from "@parfocal/ui/components/decision-buttons";
import type { Resolve, Scope } from "../src/keys/actions.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { personalBindings } from "../src/keys/personal-keys.ts";
import {
  type Binding,
  conflicts,
  type Fired,
  idleKeys,
  type KeyInput,
  step,
} from "../src/keys/registry.ts";
import { answerKeyIds, answerOfFired } from "../src/screens/review/answer-keys.ts";
import { decisionKeyActions } from "../src/screens/review/decision-mapping.ts";
import { noteAction } from "../src/screens/review/note-key.ts";
import { railKeyIds, railToolOf } from "../src/screens/review/review-rail.ts";

type Press = { key: string; code: string; shiftKey?: boolean };

function fire(bindings: readonly Binding[], press: Press): Fired[] {
  const input: KeyInput = { type: "down", at: 0, ...press };
  return step(bindings, idleKeys, input).fired;
}

const agreeAnswers: DecisionAnswer[] = [
  { raw: "agree", label: "Agree", key: "K", action: "dagree" },
  { raw: "disagree", label: "Disagree", key: "X", action: "ddisagree" },
  { raw: "unsure", label: "Not sure", key: "U", action: "dunsure" },
];

const certaintyAnswers: DecisionAnswer[] = [1, 2, 3, 4, 5].map((value) => ({
  raw: String(value),
  label: String(value),
  key: String(value),
  action: `dcert:${value}`,
}));

const letter = (key: string, shiftKey = false): Press => ({
  key: shiftKey ? key : key.toLowerCase(),
  code: `Key${key}`,
  shiftKey,
});

test("a rebound answer key answers on the new key and not on K", () => {
  const answers = agreeAnswers;
  const resolve: Resolve = { personal: { dagree: ["W"] } };
  const bindings = personalBindings(resolve, ["review"], answerKeyIds(answers));
  const answered = (press: Press) =>
    fire(bindings, press).map((fired) => answerOfFired(answers, fired));
  assert.deepEqual(answered(letter("W")), ["agree"]);
  assert.deepEqual(answered(letter("K")), []);
  assert.deepEqual(answered(letter("X")), ["disagree"]);
});

test("rebound certainty digits answer on the new keys", () => {
  const answers = certaintyAnswers;
  const resolve: Resolve = { personal: { dcert: ["⇧1 … ⇧5"] } };
  const bindings = personalBindings(resolve, ["review"], answerKeyIds(answers));
  const answered = (press: Press) =>
    fire(bindings, press).map((fired) => answerOfFired(answers, fired));
  assert.deepEqual(answered({ key: "#", code: "Digit3", shiftKey: true }), ["3"]);
  assert.deepEqual(answered({ key: "3", code: "Digit3" }), []);
});

test("a rebound note key opens the note on the new key and not on Shift+N", () => {
  const bindings = personalBindings(
    { personal: { [noteAction]: ["⇧M"] } },
    ["review"],
    [noteAction],
  );
  assert.deepEqual(fire(bindings, letter("M", true)), [{ action: noteAction, phase: "press" }]);
  assert.deepEqual(fire(bindings, letter("N", true)), []);
});

const rail = [
  [
    { tool: "select", action: "tselect" },
    { tool: "annotate", action: "annotate" },
    { tool: "ai", action: "aitools" },
  ],
];

test("a rebound Annotate opens Annotate on the new key and not on P", () => {
  const bindings = personalBindings(
    { personal: { annotate: ["⇧E"] } },
    ["review"],
    railKeyIds(rail),
  );
  const tools = (press: Press) => fire(bindings, press).map((fired) => railToolOf(rail, fired));
  assert.deepEqual(tools(letter("E", true)), ["annotate"]);
  assert.deepEqual(tools(letter("P")), []);
  assert.deepEqual(tools(letter("V")), []);
});

test("A shows or hides overlays and Shift+A opens the AI tools", () => {
  const bindings = personalBindings({}, ["review"], railKeyIds(rail));
  assert.deepEqual(
    fire(bindings, letter("A", true)).map((fired) => railToolOf(rail, fired)),
    ["ai"],
  );
  const everything = keyRegistry.bindings({ scopes: ["viewer", "review"] });
  assert.deepEqual(fire(everything, letter("A")), [{ action: "overlays", phase: "press" }]);
});

const styles = ["agree", "yesno", "certainty", "blind"] as const;
const answerIds = new Set(styles.flatMap((kind) => decisionKeyActions(kind)));

function defaultClashes(scope: Scope, extra: readonly string[] = []) {
  const ids = keyRegistry.defs
    .filter((def) => def.scope === scope || def.scope === "global")
    .map((def) => def.id)
    .filter((id) => scope !== "review" || !answerIds.has(id));
  const bindings = [...ids, ...extra].flatMap((id) =>
    keyRegistry.bindings({ scopes: [scope], only: [id] }),
  );
  return conflicts(bindings);
}

test("no two actions in one scope share a default key", () => {
  for (const scope of ["viewer", "annotate", "compare", "worklist"] as const)
    assert.deepEqual(defaultClashes(scope), [], scope);
  for (const kind of styles)
    assert.deepEqual(defaultClashes("review", decisionKeyActions(kind)), [], kind);
});
