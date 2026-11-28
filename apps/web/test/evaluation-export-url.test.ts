import assert from "node:assert/strict";
import { test } from "node:test";
import { ExportKind } from "@parfocal/api-client";
import { exportUrl } from "../src/screens/evaluation/download-export.ts";

process.env.TZ = "Europe/Prague";

test("the evaluation PDF link names the reader's time zone so the PDF prints the screen's dates", () => {
  assert.equal(
    exportUrl("t1", ExportKind.reportpdf),
    "/api/review-tasks/t1/evaluation/exports/report.pdf?zone=Europe%2FPrague",
  );
});

test("the CSV and annotation exports carry no time zone", () => {
  assert.equal(
    exportUrl("t1", ExportKind.decisionscsv),
    "/api/review-tasks/t1/evaluation/exports/decisions.csv",
  );
});
