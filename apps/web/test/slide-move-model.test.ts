import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canDrop,
  caseIdOfTarget,
  dragReason,
  looseTarget,
  moveErrors,
  moveTitle,
  reasonMin,
  targetChoices,
  undoReason,
} from "../src/screens/project/slide-move-model.ts";

test("a slide drops only on a place it is not in, loose slides included", () => {
  assert.equal(canDrop("S1", "S2"), true);
  assert.equal(canDrop("S1", null), true);
  assert.equal(canDrop(null, "S1"), true);
  assert.equal(canDrop("S1", "S1"), false);
  assert.equal(canDrop(null, null), false);
});

test("the loose target moves a slide out of its case", () => {
  assert.equal(caseIdOfTarget(looseTarget), null);
  assert.equal(caseIdOfTarget("b"), "b");
});

test("a drag and its undo give the audit log a reason long enough", () => {
  for (const reason of [dragReason("S1"), dragReason(null), undoReason("S1"), undoReason(null)]) {
    assert.equal(moveErrors("b", reason).length, 0);
    assert.ok(reason.length >= reasonMin);
  }
  assert.match(dragReason("S26-1"), /S26-1/);
  assert.match(undoReason(null), /loose/);
});

test("a loose slide is filed and a filed slide is moved", () => {
  assert.equal(moveTitle(false), "File into a case");
  assert.equal(moveTitle(true), "Move to another case");
});

test("the case a slide sits in is not offered", () => {
  const cases = [
    { id: "a", label: "S1" },
    { id: "b", label: "S2" },
  ];
  assert.deepEqual(targetChoices(cases, "S1"), [{ id: "b", label: "S2" }]);
  assert.equal(targetChoices(cases, null).length, 2);
});

test("a move needs a case and a reason of ten to five hundred characters", () => {
  assert.equal(moveErrors("b", "Filed by mistake").length, 0);
  assert.equal(moveErrors("", "Filed by mistake").length, 1);
  assert.equal(moveErrors("b", " short ").length, 1);
  assert.equal(moveErrors("b", "x".repeat(501)).length, 1);
});
