import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import { isMaintenanceError, maintenanceNotice } from "../src/shell/maintenance-notice.ts";

const started = "2026-11-15T20:00:00Z";

test("nothing shows while the platform is ok or the status is unknown", () => {
  assert.equal(maintenanceNotice(undefined), null);
  assert.equal(maintenanceNotice({ status: "ok", maintenance: null }), null);
});

test("maintenance shows its message and the expected end", () => {
  const notice = maintenanceNotice({
    status: "maintenance",
    maintenance: {
      message: "Database upgrade",
      started_at: started,
      expected_end_at: "2026-11-15T22:00:00Z",
    },
  });
  assert.deepEqual(notice, {
    message: "Database upgrade",
    expectedEndAt: new Date("2026-11-15T22:00:00Z"),
  });
});

test("maintenance without an expected end shows the message alone", () => {
  const notice = maintenanceNotice({
    status: "maintenance",
    maintenance: { message: "Short pause", started_at: started, expected_end_at: null },
  });
  assert.deepEqual(notice, { message: "Short pause", expectedEndAt: null });
});

test("only a refused write for maintenance counts as a maintenance error", () => {
  const problem = (code: string) => ({
    type: `https://parfocal.eu/problems/${code}`,
    title: "Paused",
    status: 503,
    code,
  });
  assert.equal(isMaintenanceError(new ApiError("server", 503, problem("maintenance"))), true);
  assert.equal(isMaintenanceError(new ApiError("server", 503, problem("internal"))), false);
  assert.equal(isMaintenanceError(new ApiError("server", 500, problem("maintenance"))), false);
  assert.equal(isMaintenanceError(new Error("maintenance")), false);
});
