import assert from "node:assert/strict";
import { test } from "node:test";
import { kpiEventsOf } from "../src/screens/kpi/kpi-live.ts";
import { computeKpis } from "../src/screens/kpi/kpi-model.ts";

test("recorded timing events from the API turn into dashboard events", () => {
  const events = kpiEventsOf([
    { name: "task_finished", task_kind: "review", duration_ms: 90_000 },
    { name: "cell_review_timed", duration_ms: 4000 },
    { name: "chrome_coverage_measured", area: "viewer", coverage_permille: 300 },
  ]);
  const kpis = computeKpis(events);
  assert.equal(events.length, 3);
  assert.equal(kpis.find((kpi) => kpi.key === "review")?.median, 1.5);
  assert.equal(kpis.find((kpi) => kpi.key === "cell")?.median, 4);
  assert.equal(kpis.find((kpi) => kpi.key === "chrome")?.median, 30);
});

test("no recorded events leave every measure without a median", () => {
  assert.ok(computeKpis(kpiEventsOf([])).every((kpi) => kpi.median === null));
});
