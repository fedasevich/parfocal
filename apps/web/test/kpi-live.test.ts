import assert from "node:assert/strict";
import { test } from "node:test";
import { liveKpiEvents } from "../src/screens/kpi/kpi-live.ts";
import { computeKpis } from "../src/screens/kpi/kpi-model.ts";

const caseId = "case-00000001";

test("recorded events turn into dashboard events and other names are dropped", () => {
  const events = liveKpiEvents([
    {
      name: "task_finished",
      properties: { task_kind: "review", case_id: caseId, duration_ms: 90_000 },
    },
    { name: "cell_review_timed", properties: { slide_id: caseId, duration_ms: 4000 } },
    { name: "navigation_area_opened", properties: { area: "home" } },
  ]);
  const kpis = computeKpis(events);
  assert.equal(events.length, 2);
  assert.equal(kpis.find((kpi) => kpi.key === "review")?.median, 1.5);
  assert.equal(kpis.find((kpi) => kpi.key === "cell")?.median, 4);
});
