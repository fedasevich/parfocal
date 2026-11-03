import assert from "node:assert/strict";
import { test } from "node:test";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { idleKeys, type KeyInput, step } from "../src/keys/registry.ts";
import type { Count } from "../src/screens/review/decision-mapping.ts";
import {
  type AreaKey,
  areaKey,
  areaKeyIds,
  areaNumbered,
  areaOrder,
  areaRoleText,
  areaRows,
  markVisited,
  sameSpot,
  stepArea,
  visitMagnification,
} from "../src/screens/viewer/area-nav.ts";
import { neighbourTargets } from "../src/screens/viewer-tools/edge-cues.ts";

const areas = [
  { object: "T3", size: 0.15 },
  { object: "T1", size: 6.2 },
  { object: "T4", size: 1.1 },
  { object: "T2", size: 1.6 },
];

const decisions =
  (map: Record<string, Count>) =>
  (object: string): Count | undefined =>
    map[object];

test("areas sort largest first with their number and category", () => {
  const rows = areaRows(areas, decisions({}));
  assert.deepEqual(
    rows.map((row) => [row.number, row.object, row.size, row.category]),
    [
      [1, "T1", 6.2, "macro"],
      [2, "T2", 1.6, "micro"],
      [3, "T4", 1.1, "micro"],
      [4, "T3", 0.15, "ITC"],
    ],
  );
});

test("areas of the same size keep a fixed order by name", () => {
  const rows = areaRows(
    [
      { object: "T9", size: 1 },
      { object: "T5", size: 1 },
    ],
    decisions({}),
  );
  assert.deepEqual(areaOrder(rows), ["T5", "T9"]);
});

test("the largest area sets the category and the others are open until it is agreed", () => {
  const open = areaRows(areas, decisions({}));
  assert.deepEqual(
    open.map((row) => row.role),
    ["lead", null, null, null],
  );
  const settled = areaRows(areas, decisions({ T1: "agree", T4: "disagree" }));
  assert.deepEqual(
    settled.map((row) => row.role),
    ["lead", "fixed", null, "fixed"],
  );
  assert.equal(areaRoleText.lead, "Largest, sets the category");
  assert.equal(areaRoleText.fixed, "Can't change the category");
});

test("a disagreed largest area passes the lead to the next one", () => {
  const unsure = areaRows(areas, decisions({ T1: "disagree", T2: "unsure" }));
  assert.deepEqual(
    unsure.map((row) => row.role),
    [null, "lead", null, null],
  );
  const agreed = areaRows(areas, decisions({ T1: "disagree", T2: "agree" }));
  assert.deepEqual(
    agreed.map((row) => row.role),
    [null, "lead", "fixed", "fixed"],
  );
});

test("G then n picks area n and nothing past the last", () => {
  const order = areaOrder(areaRows(areas, decisions({})));
  assert.equal(areaNumbered(order, 1), "T1");
  assert.equal(areaNumbered(order, 4), "T3");
  assert.equal(areaNumbered(order, 5), null);
  assert.equal(areaNumbered(order, 0), null);
});

test("previous and next follow the edge cue order and stop at the ends", () => {
  const order = areaOrder(areaRows(areas, decisions({})));
  for (const current of order) {
    const cues = neighbourTargets(order, current, () => [0, 0]);
    const cueOf = (direction: "back" | "next") =>
      cues.find((cue) => cue.direction === direction)?.object ?? null;
    assert.equal(stepArea(order, current, "back"), cueOf("back"));
    assert.equal(stepArea(order, current, "next"), cueOf("next"));
  }
  assert.equal(stepArea(order, "T1", "back"), null);
  assert.equal(stepArea(order, "T3", "next"), null);
  assert.equal(stepArea(order, "T2", "next"), "T4");
});

test("with no area open, next starts at the largest and previous at the smallest", () => {
  const order = ["T1", "T2", "T3"];
  assert.equal(stepArea(order, null, "next"), "T1");
  assert.equal(stepArea(order, "C1·4", "back"), "T3");
  assert.equal(stepArea([], null, "next"), null);
});

test("an area counts as visited only when seen at 10x or more", () => {
  const order = ["T1", "T2"];
  const none: ReadonlySet<string> = new Set();
  assert.equal(markVisited(none, "T1", order, visitMagnification - 0.01), none);
  const seen = markVisited(none, "T1", order, visitMagnification);
  assert.deepEqual([...seen], ["T1"]);
  assert.equal(markVisited(seen, "T1", order, 40), seen);
  assert.equal(markVisited(seen, "C1·4", order, 40), seen);
  assert.equal(markVisited(seen, null, order, 40), seen);
  const rows = areaRows(
    [
      { object: "T1", size: 2 },
      { object: "T2", size: 1 },
    ],
    decisions({}),
    seen,
  );
  assert.deepEqual(
    rows.map((row) => row.visited),
    [true, false],
  );
});

test("a spot is the same only with the same area and camera", () => {
  assert.ok(sameSpot({ object: "T1" }, { object: "T1" }));
  assert.ok(!sameSpot({ object: "T1" }, { object: "T2" }));
  assert.ok(!sameSpot({ object: "T1", x: 0.5, y: 0.5, z: 2 }, { object: "T1" }));
});

function press(keys: { key: string; code: string }[]): string[] {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"], only: areaKeyIds });
  let state = idleKeys;
  const fired: string[] = [];
  keys.forEach((key, index) => {
    const input: KeyInput = { type: "down", ...key, at: index * 10 };
    const result = step(bindings, state, input);
    state = result.state;
    for (const one of result.fired) if (one.phase === "press") fired.push(one.action);
  });
  return fired;
}

test("G then a digit, the brackets and the view keys reach the area actions", () => {
  assert.deepEqual(
    press([
      { key: "g", code: "KeyG" },
      { key: "3", code: "Digit3" },
      { key: "[", code: "BracketLeft" },
      { key: "]", code: "BracketRight" },
    ]),
    ["area:3", "prevarea", "nextarea"],
  );
});

test("fired area actions turn into a jump, a step or a move through the view history", () => {
  const order = ["T1", "T2", "T3"];
  const of = (action: string, current: string | null = "T2"): AreaKey | null =>
    areaKey({ action, phase: "press" }, order, current);
  assert.deepEqual(of("area:3"), { kind: "area", object: "T3" });
  assert.equal(of("area:9"), null);
  assert.deepEqual(of("prevarea"), { kind: "area", object: "T1" });
  assert.deepEqual(of("nextarea"), { kind: "area", object: "T3" });
  assert.equal(of("nextarea", "T3"), null);
  assert.deepEqual(of("viewback"), { kind: "back" });
  assert.deepEqual(of("viewforward"), { kind: "forward" });
  assert.equal(areaKey({ action: "nextarea", phase: "release" }, order, "T1"), null);
  assert.equal(of("fit"), null);
});
