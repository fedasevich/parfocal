import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCommand, matchText } from "../src/shell/palette-match.ts";

test("a word fragment matches and reports its letters", () => {
  assert.deepEqual(matchText("Open My work", "my")?.indices, [5, 6]);
});

test("every word of the query must match", () => {
  assert.notEqual(matchText("Open My work", "open my"), null);
  assert.equal(matchText("Open My work", "open zebra"), null);
});

test("skipped letters match across words, in order", () => {
  assert.notEqual(matchText("Mouse wheel", "mswhl"), null);
  assert.notEqual(matchText("Mouse wheel", "mouwh"), null);
  assert.equal(matchText("Mouse wheel", "wmo"), null);
});

test("accents and case are ignored", () => {
  assert.notEqual(matchText("Lenka Malá", "mala"), null);
});

test("letters spread too far apart do not match", () => {
  assert.equal(matchText("Model warnings", "meas"), null);
});

test("short queries match as substrings only", () => {
  assert.equal(matchText("Theme", "te"), null);
  assert.notEqual(matchText("Theme", "th"), null);
});

test("a whole word at a word start ranks above a loose match", () => {
  const tight = matchText("Theme", "theme")?.score ?? 0;
  const loose = matchText("Slide brightness", "sbrt")?.score ?? 0;
  assert.ok(tight > loose);
  const start = matchText("Open My work", "work")?.score ?? 0;
  const middle = matchText("Network", "work")?.score ?? 0;
  assert.ok(start > middle);
});

test("a keyword matches when the label does not, with no letters to mark", () => {
  assert.deepEqual(matchCommand("Slide brightness", ["lighter", "darker"], "dark")?.indices, []);
  assert.equal(matchCommand("Slide brightness", ["lighter"], "zebra"), null);
});

test("pieces of a path match an object ID", () => {
  assert.notEqual(matchText("T2·C145 on A1", "c145"), null);
  assert.notEqual(matchText("P07/S26-04812/A1/T2·C145", "s26 a1"), null);
});
