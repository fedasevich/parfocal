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

const cluster: AiArea[] = [
  { object: "T6", size: 0.12, cells: { low: 20, high: 60 } },
  { object: "T5", size: 0.18, probability: 0.71 },
];

const stepsOf = (state: ReturnType<typeof aiState>) =>
  state.kind === "small-cluster" ? state.steps.map((step) => [step.step, step.done]) : null;

test("a largest area at or under 0.2 mm reads as a small cluster with every step open", () => {
  const state = aiState({ areas: cluster });
  assert.equal(state.kind, "small-cluster");
  if (state.kind !== "small-cluster") return;
  assert.equal(state.phase, "open");
  assert.equal(state.lead.object, "T5");
  assert.equal(state.category, "ITC");
  assert.deepEqual(stepsOf(state), [
    ["confirm", false],
    ["measure", false],
    ["count", false],
  ]);
});

test("the cluster steps follow the staging state and settle only with a firm count", () => {
  const lead = (patch: Partial<AiArea>) =>
    cluster.map((area) => (area.object === "T5" ? { ...area, ...patch } : area));
  const measured = aiState({ areas: lead({ call: "agree", measured: 0.17 }) });
  assert.deepEqual(stepsOf(measured), [
    ["confirm", true],
    ["measure", true],
    ["count", false],
  ]);
  assert.equal(measured.kind === "small-cluster" && measured.phase, "open");
  const crossing = aiState({
    areas: lead({ call: "agree", measured: 0.17, cells: { low: 150, high: 240 } }),
  });
  assert.equal(crossing.kind === "small-cluster" && crossing.phase, "open");
  const under = aiState({
    areas: lead({ call: "agree", measured: 0.17, cells: { low: 150, high: 190 } }),
  });
  assert.equal(under.kind, "small-cluster");
  if (under.kind !== "small-cluster") return;
  assert.equal(under.phase, "settled");
  assert.equal(under.pn, "pN0(i+)(sn)");
  assert.deepEqual(
    under.areas.map((area) => area.canChangeCategory),
    [true, false],
  );
});

test("a firm count over 200 cells makes a small cluster a micrometastasis", () => {
  const state = aiState({
    areas: [
      { object: "T5", size: 0.18, call: "agree", measured: 0.19, cells: { low: 210, high: 260 } },
    ],
  });
  assert.equal(state.kind, "small-cluster");
  if (state.kind !== "small-cluster") return;
  assert.equal(state.phase, "settled");
  assert.equal(state.category, "micro");
  assert.equal(state.pn, "pN1mi(sn)");
});

test("measuring a small cluster over 0.2 mm turns it back into a pre-read", () => {
  const state = aiState({ areas: [{ object: "T5", size: 0.18, call: "agree", measured: 0.25 }] });
  assert.equal(state.kind, "pre-read");
  assert.equal(state.kind === "pre-read" && state.phase, "settled");
});
