import assert from "node:assert/strict";
import { test } from "node:test";
import { computeKpis, estimateErrors, type KpiEvent } from "../src/screens/kpi/kpi-model.ts";
import { seededKpiEvents } from "../src/screens/kpi/kpi-seed.ts";
import { eventSink } from "../src/telemetry/events.ts";
import { createTaskTimer } from "../src/telemetry/task-timer.ts";

const caseId = "case-00000001";

function recorder(optedOut = false) {
  const seen: { name: string; properties: Record<string, unknown> }[] = [];
  const sink = eventSink(
    {
      capture: (name: string, properties: Record<string, unknown>) =>
        void seen.push({ name, properties }),
    },
    () => optedOut,
  );
  const clock = { at: 0 };
  const timer = createTaskTimer(sink, () => clock.at);
  const advance = (ms: number) => {
    clock.at += ms;
  };
  return { seen, timer, advance };
}

test("a finished task reports its duration and the estimate comparison", () => {
  const { seen, timer, advance } = recorder();
  timer.start("review", caseId);
  advance(600_000);
  timer.finish("review", caseId, 720_000);
  assert.deepEqual(
    seen.map((event) => event.name),
    ["task_started", "task_finished", "reading_time_compared"],
  );
  assert.equal(seen[1]?.properties["duration_ms"], 600_000);
  assert.equal(seen[2]?.properties["estimated_ms"], 720_000);
});

test("an abandoned task reports its duration and a finish without a start reports nothing", () => {
  const { seen, timer, advance } = recorder();
  timer.finish("report", caseId);
  timer.start("report", caseId);
  advance(5_000);
  timer.abandon("report", caseId);
  assert.deepEqual(
    seen.map((event) => event.name),
    ["task_started", "task_abandoned"],
  );
});

test("area, cell and chrome measurements are ids and counts only", () => {
  const { seen, timer, advance } = recorder();
  timer.areaEntered();
  advance(30_000);
  timer.areaLeft("viewer");
  timer.cellShown();
  advance(7_000);
  timer.cellDecided("slide-00000001");
  timer.chromeMeasured("viewer", 0.3333);
  assert.equal(seen.length, 3);
  assert.equal(seen[2]?.properties["coverage_permille"], 333);
});

test("nothing is recorded after the analytics opt-out", () => {
  const { seen, timer, advance } = recorder(true);
  timer.start("review", caseId);
  advance(1_000);
  timer.finish("review", caseId, 2_000);
  timer.areaEntered();
  timer.areaLeft("viewer");
  assert.equal(seen.length, 0);
});

test("the seeded data fills every measure and is judged against the kit targets", () => {
  const kpis = computeKpis(seededKpiEvents);
  assert.ok(kpis.every((kpi) => kpi.samples > 0 && kpi.median !== null));
  assert.equal(kpis.find((kpi) => kpi.key === "review")?.target?.limit, 15);
  assert.equal(kpis.find((kpi) => kpi.key === "review")?.met, true);
  assert.equal(kpis.find((kpi) => kpi.key === "chrome")?.met, true);
  assert.equal(kpis.find((kpi) => kpi.key === "cell")?.met, null);
});

test("a slow median is over target and an empty measure has no median", () => {
  const slow: KpiEvent[] = [
    { name: "task_finished", task_kind: "review", duration_ms: 20 * 60_000 },
  ];
  const kpis = computeKpis(slow);
  assert.equal(kpis.find((kpi) => kpi.key === "review")?.met, false);
  assert.equal(kpis.find((kpi) => kpi.key === "cell")?.median, null);
});

test("estimate error is the share the actual time is off by", () => {
  const errors = estimateErrors([
    {
      name: "reading_time_compared",
      task_kind: "review",
      estimated_ms: 10_000,
      duration_ms: 12_000,
    },
  ]);
  assert.deepEqual(errors, [20]);
});
