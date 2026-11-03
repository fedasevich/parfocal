import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classKeyBindings, slotOfFired } from "../src/annotations/class-keys.ts";
import {
  type ClassPick,
  type ClassSlot,
  type ClassState,
  classAtSlot,
  pickClass,
  pickClassSlot,
  slotOfAction,
} from "../src/annotations/classes.ts";
import {
  addGroup,
  addRun,
  addShape,
  createDocument,
  getShape,
  promoteRunPiece,
  updateShape,
} from "../src/annotations/document.ts";
import { runFromProposals } from "../src/annotations/runs.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { conflicts, idleKeys, type KeyInput, step } from "../src/keys/registry.ts";
import { decisionKeyActions } from "../src/screens/review/decision-mapping.ts";
import { reviewToolActions } from "../src/screens/review/review-rail.ts";

const classes: ClassSlot[] = [
  { key: "tumor", name: "Tumor" },
  { key: "stroma", name: "Stroma" },
  { key: "immune", name: "Immune" },
  { key: "other", name: "Other" },
];

const square = Float32Array.of(0, 0, 10, 0, 10, 10, 0, 10);

function fixture(): ClassState {
  const run = runFromProposals({ id: 3, model: "nuclei-seg", version: "1.0", classKey: "tumor" }, [
    { points: Float32Array.of(0, 0, 4, 0, 4, 4), confidence: 0.9 },
    { points: Float32Array.of(10, 10, 14, 10, 14, 14), confidence: 0.6 },
  ]);
  let document = addRun(createDocument(), run);
  document = addShape(document, { kind: "polygon", points: square, classKey: "stroma" }).document;
  document = promoteRunPiece(document, 3, 0).document;
  document = promoteRunPiece(document, 3, 1).document;
  document = addShape(document, {
    kind: "ruler",
    points: Float32Array.of(0, 0, 5, 5),
  }).document;
  return { document, selection: [], activeClass: "tumor" };
}

const human = 1;
const modelA = 2;
const modelB = 3;
const ruler = 4;

function pressDigit(digit: number) {
  const input: KeyInput = { type: "down", key: String(digit), code: `Digit${digit}`, at: 0 };
  return step(classKeyBindings(), idleKeys, input).fired;
}

function byKey(state: ClassState, digit: number, context: "annotate" | "review"): ClassPick | null {
  const fired = pressDigit(digit);
  assert.equal(fired.length, 1);
  const slot = slotOfFired(fired[0] ?? { action: "", phase: "press" });
  return slot === null ? null : pickClassSlot(state, classes, slot, context);
}

function bySwatch(state: ClassState, swatch: ClassSlot, context: "annotate" | "review") {
  return pickClass(state, swatch.key, context);
}

function sameOutcome(a: ClassPick | null, b: ClassPick | null) {
  assert.ok(a && b);
  assert.deepEqual(a.changed, b.changed);
  assert.deepEqual(a.taught, b.taught);
  assert.equal(a.state.activeClass, b.state.activeClass);
  assert.deepEqual([...a.state.document.shapes.values()], [...b.state.document.shapes.values()]);
}

describe("class keys", () => {
  test("digits 1 to 9 fire the class action with the slot number", () => {
    for (let digit = 1; digit <= 9; digit++)
      assert.deepEqual(pressDigit(digit), [{ action: `aclass:${digit}`, phase: "press" }]);
    assert.equal(slotOfAction("aclass:4"), 4);
    assert.equal(slotOfAction("aclass:0"), null);
    assert.equal(slotOfAction("dcert:4"), null);
  });

  test("a digit past the taxonomy picks nothing", () => {
    assert.equal(classAtSlot(classes, 5), undefined);
    assert.equal(byKey(fixture(), 5, "annotate"), null);
  });

  test("the class keys clash with no other Annotate or viewer key", () => {
    const bindings = keyRegistry.bindings({ scopes: ["viewer", "annotate"] });
    const clashes = conflicts(bindings).filter((pair) =>
      pair.some((action) => action.startsWith("aclass")),
    );
    assert.deepEqual(clashes, []);
  });

  test("the review workspace keeps its digits for the decision answer in every style", () => {
    for (const kind of ["agree", "yesno", "certainty", "blind"] as const) {
      const bindings = keyRegistry.bindings({
        scopes: ["viewer", "review", "annotate"],
        only: [...decisionKeyActions(kind), ...Object.keys(reviewToolActions)],
      });
      assert.ok(!bindings.some((binding) => binding.action.startsWith("aclass")), kind);
      assert.deepEqual(conflicts(bindings), [], kind);
    }
    const certainty = keyRegistry.bindings({
      scopes: ["viewer", "review", "annotate"],
      only: [...decisionKeyActions("certainty"), ...Object.keys(reviewToolActions)],
    });
    const three: KeyInput = { type: "down", key: "3", code: "Digit3", at: 0 };
    assert.deepEqual(step(certainty, idleKeys, three).fired, [
      { action: "dcert:3", phase: "press" },
    ]);
  });
});

describe("picking a class", () => {
  test("with nothing selected it sets the class for new shapes and changes no shape", () => {
    const state = fixture();
    const picked = pickClass(state, "immune", "annotate");
    assert.equal(picked.state.activeClass, "immune");
    assert.equal(picked.state.document, state.document);
    assert.deepEqual(picked.changed, []);
  });

  test("with a selection it re-classes it and keeps the class for new shapes", () => {
    const state = { ...fixture(), selection: [human, modelA] };
    const picked = pickClass(state, "immune", "annotate");
    assert.equal(picked.state.activeClass, "tumor");
    assert.deepEqual(picked.changed, [human, modelA]);
    assert.equal(getShape(picked.state.document, human)?.classKey, "immune");
    assert.equal(getShape(picked.state.document, modelA)?.classKey, "immune");
    assert.equal(getShape(picked.state.document, modelA)?.reviewState, "unreviewed");
    assert.deepEqual(picked.taught, []);
  });

  test("measures and locked shapes keep their class", () => {
    const base = fixture();
    const locked = addGroup(base.document, "Done", { locked: true });
    const document = updateShape(locked.document, human, { groupId: locked.group.id }).document;
    const state = { ...base, document, selection: [human, ruler] };
    const picked = pickClass(state, "immune", "annotate");
    assert.deepEqual(picked.changed, []);
    assert.equal(getShape(picked.state.document, ruler)?.classKey, null);
  });

  test("in review a model shape is marked reviewed and a changed class is taught", () => {
    const state = { ...fixture(), selection: [modelA, modelB, human] };
    const kept = pickClass({ ...state, selection: [modelA] }, "tumor", "review");
    assert.equal(getShape(kept.state.document, modelA)?.reviewState, "agreed");
    assert.deepEqual(kept.taught, []);

    const picked = pickClass(state, "stroma", "review");
    assert.equal(getShape(picked.state.document, modelA)?.reviewState, "disagreed");
    assert.equal(getShape(picked.state.document, modelB)?.classKey, "stroma");
    assert.equal(getShape(picked.state.document, human)?.reviewState, "unreviewed");
    assert.deepEqual(picked.taught, [
      { shapeId: modelA, runId: 3, piece: 0, fromClass: "tumor", toClass: "stroma" },
      { shapeId: modelB, runId: 3, piece: 1, fromClass: "tumor", toClass: "stroma" },
    ]);
    assert.deepEqual(picked.changed, [modelA, modelB]);
  });
});

describe("key and swatch behave the same", () => {
  const cases: [string, ClassState][] = [
    ["nothing selected", fixture()],
    ["a human shape selected", { ...fixture(), selection: [human] }],
    ["model shapes and a ruler selected", { ...fixture(), selection: [modelA, modelB, ruler] }],
  ];
  for (const [name, state] of cases)
    for (const context of ["annotate", "review"] as const)
      for (let digit = 1; digit <= classes.length; digit++)
        test(`${name}, ${context}, key ${digit}`, () => {
          const swatch = classes[digit - 1];
          assert.ok(swatch);
          sameOutcome(byKey(state, digit, context), bySwatch(state, swatch, context));
        });
});
