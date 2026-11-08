import assert from "node:assert/strict";
import { test } from "node:test";
import { moveErrors, moveTitle, targetChoices } from "../src/screens/project/slide-move-model.ts";

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
