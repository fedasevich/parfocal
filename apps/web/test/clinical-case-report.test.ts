import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseReport } from "@parfocal/api-client";
import {
  changeBetween,
  isAmended,
  isEmptyChange,
  issuesOfBlockers,
  newDepositOf,
  phaseOf,
  valuesOfCaseReport,
} from "../src/screens/clinical-report/case-report.ts";

const slide = "00000000-0000-4000-8005-000000000001";

const report = (patch: Partial<CaseReport> = {}): CaseReport => ({
  id: "r1",
  project_id: "p1",
  case_id: "c1",
  state: "draft",
  template: { key: "sentinel-node", name: "Sentinel node report", version: 1, steps: ["findings"] },
  specimen: "Sentinel node, right axilla",
  category: "none",
  nodes_examined: null,
  extranodal: null,
  diagnosis: null,
  microscopic: null,
  comment: null,
  deposits: [
    { id: "d1", slide_id: slide, object_id: "T1", size_mm: 8, note: null, largest: true },
    { id: "d2", slide_id: slide, object_id: "T2", size_mm: null, note: "edge", largest: false },
  ],
  staging: null,
  findings: { decisions: [], measurements: [] },
  blockers: [],
  cosigner_user_id: null,
  sent_by_user_id: null,
  return_note: null,
  version: 1,
  versions: [],
  ...patch,
});

test("the server report becomes the form values with a measured and an unmeasured deposit", () => {
  const values = valuesOfCaseReport(report());
  assert.equal(values.category, null);
  assert.equal(values.specimen, "Sentinel node, right axilla");
  assert.deepEqual(
    values.deposits.map((deposit) => [deposit.id, deposit.size, deposit.unmeasured ?? false]),
    [
      ["d1", "8", false],
      ["d2", "", true],
    ],
  );
});

test("a change carries only the fields that differ", () => {
  const before = valuesOfCaseReport(report());
  assert.ok(isEmptyChange(changeBetween(before, before)));
  const change = changeBetween(before, {
    ...before,
    diagnosis: " Metastatic carcinoma ",
    examined: "4",
    extranodal: "absent",
  });
  assert.deepEqual(change, {
    diagnosis: "Metastatic carcinoma",
    nodes_examined: 4,
    extranodal: "absent",
  });
});

test("a category that was ticked to keep goes out with its confirmation", () => {
  const before = valuesOfCaseReport(report());
  assert.deepEqual(changeBetween(before, { ...before, category: "micro", ack: true }), {
    category: "micro",
    confirm_category: true,
  });
  assert.deepEqual(changeBetween(before, { ...before, category: "macro" }), {
    category: "macro",
  });
});

test("a deposit from an object and one by hand become new deposits", () => {
  assert.deepEqual(
    newDepositOf({ slide, objectId: "T4", size: "1,5", note: " near the capsule " }),
    { slide_id: slide, object_id: "T4", size_mm: 1.5, note: "near the capsule" },
  );
  assert.deepEqual(newDepositOf({ slide, objectId: null, size: "0", note: "" }), {
    slide_id: slide,
    object_id: null,
  });
});

test("each blocker becomes an issue on its step", () => {
  const issues = issuesOfBlockers([
    { code: "required-field-empty", field: "specimen" },
    { code: "required-field-empty", field: "diagnosis" },
    { code: "deposit-without-size", deposit_id: "d2" },
    { code: "category-not-confirmed" },
  ]);
  assert.deepEqual(
    issues.map((issue) => [issue.step, issue.field]),
    [
      ["findings", "specimen"],
      ["text", "diag"],
      ["staging", "deps.d2"],
      ["staging", "ack"],
    ],
  );
});

test("the state decides the phase and the amended flag", () => {
  assert.equal(phaseOf(report({ state: "returned" })), "editing");
  assert.equal(phaseOf(report({ state: "sent" })), "sent");
  assert.equal(phaseOf(report({ state: "amended" })), "signed");
  assert.equal(isAmended(report({ state: "amended" })), true);
  assert.equal(isAmended(report({ state: "signed" })), false);
});
