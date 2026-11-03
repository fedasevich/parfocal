import assert from "node:assert/strict";
import { test } from "node:test";
import { type AiArea, aiState, findingWords } from "../src/lib/ai-state.ts";

const areas: AiArea[] = [
  { object: "T2", size: 1.3 },
  { object: "T1", size: 7.7, probability: 0.68 },
  { object: "T3", size: 0.15 },
];

test("an unconfirmed pre-read is open and leads with the largest area", () => {
  const state = aiState({ areas });
  assert.equal(state.kind, "pre-read");
  if (state.kind !== "pre-read") return;
  assert.equal(state.phase, "open");
  assert.equal(state.lead.object, "T1");
  assert.equal(state.category, "macro");
  assert.deepEqual(
    state.areas.map((area) => [area.number, area.object, area.category]),
    [
      [1, "T1", "macro"],
      [2, "T2", "micro"],
      [3, "T3", "ITC"],
    ],
  );
  assert.ok(state.areas.every((area) => area.canChangeCategory));
});

test("confirming alone does not settle, measuring after confirming does", () => {
  const confirmed = areas.map((area) =>
    area.object === "T1" ? { ...area, call: "agree" as const } : area,
  );
  const open = aiState({ areas: confirmed });
  assert.equal(open.kind === "pre-read" && open.phase, "open");
  const measured = confirmed.map((area) =>
    area.object === "T1" ? { ...area, measured: 8 } : area,
  );
  const settled = aiState({ areas: measured });
  assert.equal(settled.kind, "pre-read");
  if (settled.kind !== "pre-read") return;
  assert.equal(settled.phase, "settled");
  assert.equal(settled.size, 8);
  assert.equal(settled.pn, "pN1a(sn)");
  assert.deepEqual(
    settled.areas.map((area) => area.canChangeCategory),
    [true, false, false],
  );
});

test("a rejected largest area hands the lead to the next one", () => {
  const rejected = areas.map((area) =>
    area.object === "T1" ? { ...area, call: "disagree" as const } : area,
  );
  const state = aiState({ areas: rejected });
  assert.equal(state.kind === "pre-read" && state.lead.object, "T2");
  assert.equal(state.kind === "pre-read" && state.category, "micro");
});

test("no areas reads as no tumor and a running job reads as running", () => {
  assert.equal(aiState({ areas: [] }).kind, "no-tumor");
  assert.equal(aiState({ areas, running: true }).kind, "running");
});

test("finding words follow the confidence band and the wording mode", () => {
  assert.equal(findingWords("Metastasis", 0.68), "Metastasis likely");
  assert.equal(findingWords("Metastasis", 0.45), "Metastasis possible");
  assert.equal(findingWords("Metastasis", 0.2), "Metastasis unclear");
  assert.equal(findingWords("Metastasis", undefined), "Metastasis likely");
  assert.equal(findingWords("Metastasis", 0.68, "percent"), "Metastasis 68%");
  const uncalibrated = { name: "X", calibrated: false, checkedOnHeldOut: false, bandAccuracy: {} };
  assert.equal(findingWords("Metastasis", 0.68, "plain", uncalibrated), "Metastasis 68%");
});

test("a running job keeps areas in the order they were found so rows never move", () => {
  const state = aiState({ areas, running: true });
  assert.equal(state.kind, "running");
  assert.deepEqual(
    state.areas.map((area) => [area.number, area.object, area.lead]),
    [
      [1, "T2", false],
      [2, "T1", false],
      [3, "T3", false],
    ],
  );
});
