import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseReport, CaseReportChange, NewCaseReportDeposit } from "@parfocal/api-client";
import { valuesOfCaseReport } from "../src/screens/clinical-report/case-report.ts";
import { pushValues, type ReportWriter } from "../src/screens/clinical-report/report-sync.ts";

const slide = "00000000-0000-4000-8005-000000000001";

const serverReport = (): CaseReport => ({
  id: "r1",
  project_id: "p1",
  case_id: "c1",
  state: "draft",
  template: { key: "sentinel-node", name: "Sentinel node report", version: 1, steps: ["findings"] },
  specimen: "Sentinel node",
  category: "none",
  nodes_examined: null,
  extranodal: null,
  diagnosis: null,
  microscopic: null,
  comment: null,
  deposits: [
    { id: "s1", slide_id: slide, object_id: "T1", size_mm: 8, note: null, largest: true },
    { id: "s2", slide_id: slide, object_id: "T2", size_mm: 6.4, note: null, largest: false },
  ],
  staging: null,
  findings: { decisions: [], measurements: [] },
  blockers: [],
  signers: [],
  cosigner_user_id: null,
  sent_by_user_id: null,
  sent_at: null,
  sent: null,
  changes: [],
  return_note: null,
  version: 1,
  versions: [],
});

function recorder() {
  const state = serverReport();
  const calls: string[] = [];
  let next = 3;
  const writer: ReportWriter = {
    patch: (change: CaseReportChange) => {
      calls.push(`patch ${JSON.stringify(change)}`);
      return Promise.resolve(state);
    },
    add: (deposit: NewCaseReportDeposit) => {
      calls.push(`add ${deposit.object_id ?? "hand"} ${deposit.size_mm ?? "none"}`);
      state.deposits = [
        ...state.deposits,
        {
          id: `s${next}`,
          slide_id: deposit.slide_id,
          object_id: deposit.object_id ?? null,
          size_mm: deposit.size_mm ?? null,
          note: deposit.note ?? null,
          largest: false,
        },
      ];
      next += 1;
      return Promise.resolve(state);
    },
    remove: (id: string) => {
      calls.push(`remove ${id}`);
      state.deposits = state.deposits.filter((deposit) => deposit.id !== id);
      return Promise.resolve(state);
    },
  };
  return { writer, calls };
}

const start = () => valuesOfCaseReport(serverReport());

test("nothing is sent when nothing changed", async () => {
  const { writer, calls } = recorder();
  const saved = start();
  const result = await pushValues(writer, saved, saved);
  assert.deepEqual(calls, []);
  assert.equal(result.server, null);
});

test("a deposit added by hand and one from an object are sent and get their server ids", async () => {
  const { writer, calls } = recorder();
  const saved = start();
  const current = {
    ...saved,
    deposits: [
      ...saved.deposits,
      { id: "D3", slide, objectId: null, size: "1.5", note: "" },
      { id: "D4", slide, objectId: "T4", size: "0.9", note: "" },
    ],
  };
  const result = await pushValues(writer, saved, current);
  assert.deepEqual(calls, ["add hand 1.5", "add T4 0.9"]);
  assert.deepEqual(
    result.saved.deposits.map((deposit) => [deposit.id, deposit.serverId]),
    [
      ["D1", "s1"],
      ["D2", "s2"],
      ["D3", "s3"],
      ["D4", "s4"],
    ],
  );
});

test("a removed deposit is deleted on the server", async () => {
  const { writer, calls } = recorder();
  const saved = start();
  const current = { ...saved, deposits: saved.deposits.slice(0, 1) };
  const result = await pushValues(writer, saved, current);
  assert.deepEqual(calls, ["remove s2"]);
  assert.equal(result.saved.deposits.length, 1);
});

test("a removed deposit that comes back after the delete is added again under its label", async () => {
  const { writer, calls } = recorder();
  const saved = start();
  const gone = await pushValues(writer, saved, { ...saved, deposits: saved.deposits.slice(0, 1) });
  const back = await pushValues(writer, gone.saved, saved);
  assert.deepEqual(calls, ["remove s2", "add T2 6.4"]);
  assert.deepEqual(
    back.saved.deposits.map((deposit) => [deposit.id, deposit.serverId]),
    [
      ["D1", "s1"],
      ["D2", "s3"],
    ],
  );
});

test("a changed size replaces the deposit and a half typed size waits", async () => {
  const { writer, calls } = recorder();
  const saved = start();
  const changed = {
    ...saved,
    deposits: saved.deposits.map((deposit) =>
      deposit.id === "D2" ? { ...deposit, size: "5.5" } : deposit,
    ),
  };
  const result = await pushValues(writer, saved, changed);
  assert.deepEqual(calls, ["remove s2", "add T2 5.5"]);
  const typing = {
    ...result.saved,
    deposits: result.saved.deposits.map((deposit) =>
      deposit.id === "D1" ? { ...deposit, size: "8." } : deposit,
    ),
  };
  const waiting = await pushValues(writer, result.saved, typing);
  assert.equal(calls.length, 2);
  assert.equal(waiting.saved.deposits[0]?.size, "8");
});

test("the text fields, the category with its confirmation and the counts go out in one patch", async () => {
  const { writer, calls } = recorder();
  const saved = start();
  await pushValues(writer, saved, {
    ...saved,
    category: "micro",
    ack: true,
    examined: "2",
    extranodal: "absent",
    diagnosis: "Metastatic carcinoma",
  });
  assert.deepEqual(calls, [
    'patch {"diagnosis":"Metastatic carcinoma","category":"micro","confirm_category":true,"nodes_examined":2,"extranodal":"absent"}',
  ]);
});
