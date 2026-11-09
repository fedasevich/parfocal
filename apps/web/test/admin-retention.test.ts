import assert from "node:assert/strict";
import { test } from "node:test";
import { classListNames } from "../src/screens/admin/projects-model.ts";
import {
  daysText,
  retentionChange,
  retentionChoices,
  retentionDays,
  retentionNotice,
} from "../src/screens/admin/retention-model.ts";

test("a workspace with no retention policy keeps everything", () => {
  assert.equal(retentionDays({}, "deleted_after_days"), null);
  assert.equal(retentionDays({}, "audit_after_days"), null);
  assert.equal(daysText(null), "Keep everything");
});

test("periods read as days or years", () => {
  assert.equal(daysText(1), "1 day");
  assert.equal(daysText(30), "30 days");
  assert.equal(daysText(365), "1 year");
  assert.equal(daysText(1825), "5 years");
});

test("audit choices never go below one year and a saved odd value stays listed", () => {
  assert.deepEqual(retentionChoices("audit_after_days", null), [null, 365, 730, 1825, 3650]);
  assert.deepEqual(retentionChoices("deleted_after_days", 45), [null, 7, 30, 45, 90, 180, 365]);
});

test("changing one period keeps the other", () => {
  const policy = { deleted_after_days: 30, audit_after_days: 730 };
  assert.deepEqual(retentionChange(policy, "deleted_after_days", null), {
    deleted_after_days: null,
    audit_after_days: 730,
  });
  assert.deepEqual(retentionChange({}, "audit_after_days", 365), {
    deleted_after_days: null,
    audit_after_days: 365,
  });
});

test("the notice says what is removed and when", () => {
  assert.equal(
    retentionNotice("deleted_after_days", 90),
    "Deleted slides, annotations and results are removed after 90 days.",
  );
  assert.equal(retentionNotice("audit_after_days", null), "Audit events are kept for good.");
});

test("the built-in class lists are named for the admin", () => {
  assert.equal(
    classListNames([{ template: "sentinel-node" }, { template: "pannuke" }]),
    "Sentinel node, PanNuke",
  );
});
