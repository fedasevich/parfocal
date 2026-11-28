import assert from "node:assert/strict";
import { test } from "node:test";
import { stampOf } from "../src/screens/clinical-report/case-report.ts";
import { readerZone, reportPdfUrl } from "../src/screens/clinical-report/pdf-link.ts";

process.env.TZ = "Europe/Prague";

test("the PDF link names the reader's time zone so the PDF prints the preview's times", () => {
  assert.equal(readerZone(), "Europe/Prague");
  assert.equal(
    reportPdfUrl("p1", "c1", 2),
    "/api/projects/p1/cases/c1/clinical-report/versions/2/pdf?zone=Europe%2FPrague",
  );
});

test("the preview shows a signing at 21:17 UTC as 22:17 in Prague, as the PDF test expects", () => {
  assert.equal(stampOf("2026-11-23T21:17:00Z"), "23 Nov 22:17");
  assert.equal(stampOf("2026-12-31T23:30:00Z"), "1 Jan 00:30");
});
