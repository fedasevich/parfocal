import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { CaseDetail, CaseReport, CaseReportVersion, Project } from "@parfocal/api-client";
import { assembleReport } from "../src/screens/clinical-report/case-report.ts";
import { documentOf } from "../src/screens/clinical-report/model.ts";

process.env.TZ = "UTC";

type ParityCase = {
  name: string;
  lab: string;
  names: Record<string, string>;
  project: unknown;
  case: unknown;
  report: unknown;
  versions: CaseReportVersion[];
  expected: unknown;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../packages/test-fixtures/report-document.json", import.meta.url),
    "utf8",
  ),
) as { cases: ParityCase[] };

for (const item of fixture.cases) {
  test(`the on-screen report model matches the shared fixture: ${item.name}`, () => {
    const assembled = assembleReport({
      project: item.project as Project,
      caseDetail: item.case as CaseDetail,
      server: item.report as CaseReport,
      userId: "",
      first: item.versions[0] ?? null,
    });
    const document = documentOf(
      assembled.data,
      assembled.report,
      "current",
      (id) => item.names[id] ?? id,
      item.lab,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(document)), item.expected);
  });
}
