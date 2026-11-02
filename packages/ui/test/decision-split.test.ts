import assert from "node:assert/strict";
import { test } from "node:test";
import { donePercent, ringArcs, stackedParts } from "../src/lib/decision-split.ts";

const circumference = 100;

test("ring arcs run in decision order and fill the circle without gaps", () => {
  const arcs = ringArcs({ agree: 20, disagree: 6, unsure: 4, open: 20 }, circumference);
  assert.deepEqual(
    arcs.map((arc) => arc.decision),
    ["agree", "disagree", "unsure", "open"],
  );
  assert.deepEqual(
    arcs.map((arc) => arc.length),
    [40, 12, 8, 40],
  );
  assert.deepEqual(
    arcs.map((arc) => arc.offset),
    [0, 40, 52, 60],
  );
  const last = arcs[arcs.length - 1];
  assert.ok(last);
  assert.equal(last.offset + last.length, circumference);
});

test("ring arcs skip empty decisions and give none for an empty split", () => {
  const arcs = ringArcs({ agree: 3, disagree: 0, unsure: 0, open: 1 }, circumference);
  assert.deepEqual(
    arcs.map((arc) => arc.decision),
    ["agree", "open"],
  );
  assert.deepEqual(ringArcs({ agree: 0, disagree: 0, unsure: 0, open: 0 }, circumference), []);
});

test("done percent counts every answered slide and rounds", () => {
  assert.equal(donePercent({ agree: 0, disagree: 0, unsure: 0, open: 0 }), 0);
  assert.equal(donePercent({ agree: 0, disagree: 0, unsure: 0, open: 55 }), 0);
  assert.equal(donePercent({ agree: 20, disagree: 6, unsure: 4, open: 25 }), 55);
  assert.equal(donePercent({ agree: 38, disagree: 11, unsure: 6, open: 0 }), 100);
  assert.equal(donePercent({ agree: 1, disagree: 0, unsure: 0, open: 2 }), 33);
});

test("stacked parts add up to the whole bar", () => {
  const parts = stackedParts({ agree: 38, unsure: 6, disagree: 11 });
  assert.deepEqual(
    parts.map((part) => part.decision),
    ["agree", "unsure", "disagree"],
  );
  assert.equal(
    parts.reduce((sum, part) => sum + part.count, 0),
    55,
  );
  const shares = parts.reduce((sum, part) => sum + part.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-12);
});

test("stacked parts of an empty split are all zero", () => {
  const parts = stackedParts({ agree: 0, unsure: 0, disagree: 0 });
  assert.deepEqual(
    parts.map((part) => part.share),
    [0, 0, 0],
  );
});
