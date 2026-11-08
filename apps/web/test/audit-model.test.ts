import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditFileName,
  auditLabel,
  auditParams,
  defaultAuditFilter,
  periodTitle,
} from "../src/screens/admin/audit-model.ts";

const today = new Date(2026, 9, 15, 14, 30);

test("the default filter asks for today's events only", () => {
  assert.deepEqual(auditParams(defaultAuditFilter, today), {
    since: new Date(2026, 9, 15).toISOString(),
  });
});

test("every chosen filter becomes its query parameter", () => {
  assert.deepEqual(
    auditParams({ person: "u1", project: "p1", period: "week", group: "member." }, today),
    {
      person: "u1",
      project_id: "p1",
      action_prefix: "member.",
      since: new Date(2026, 9, 9).toISOString(),
    },
  );
});

test("any time sends no date", () => {
  assert.deepEqual(auditParams({}, today), {});
  assert.equal(periodTitle(undefined), "Any time");
  assert.equal(periodTitle("month"), "Last 30 days");
});

test("actions read as sentences and unknown ones name their area", () => {
  assert.equal(auditLabel("tenant.session-policy-changed"), "Changed the lock times");
  assert.equal(auditLabel("project.emergency-access"), "Used emergency access");
  assert.equal(auditLabel("legal-hold.placed"), "Legal hold event");
});

test("the export file is named by the day", () => {
  assert.equal(auditFileName(today), "parfocal-audit-2026-10-15.json");
});
