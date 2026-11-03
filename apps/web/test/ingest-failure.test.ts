import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestFailureView, supportHref } from "../src/upload/ingest-failure.ts";

const failed = (reason: string, failureClass: "transient" | "permanent", message: string) => ({
  status: "failed" as const,
  reason,
  message,
  failure_class: failureClass,
});

test("a transient failure keeps its message and has no support link", () => {
  const view = ingestFailureView(
    failed("check-stopped", "transient", "Checking this file was stopped. Upload it again."),
    "tumor_044.svs",
  );
  assert.deepEqual(view, {
    fileName: "tumor_044.svs",
    message: "Checking this file was stopped. Upload it again.",
    failureClass: "transient",
    supportHref: undefined,
  });
});

test("a permanent failure carries a support link that names the reason", () => {
  const view = ingestFailureView(
    failed("zeiss-czi", "permanent", "Zeiss CZI files are not supported."),
    "tumor_060.czi",
  );
  assert.equal(view?.failureClass, "permanent");
  assert.equal(
    view?.supportHref,
    "mailto:support@parfocal.eu?subject=Refused%20upload%20zeiss-czi",
  );
});

test("a failure without a class is treated as permanent", () => {
  const view = ingestFailureView(
    { status: "failed", reason: "unknown", message: null, failure_class: null },
    "notes.svs",
  );
  assert.equal(view?.failureClass, "permanent");
  assert.equal(view?.message, "Parfocal could not take this file in.");
});

test("a file that is not failed has no failure view", () => {
  for (const status of ["uploading", "waiting", "processing", "ready"] as const) {
    const view = ingestFailureView(
      { status, reason: null, message: null, failure_class: null },
      "a.svs",
    );
    assert.equal(view, null);
  }
});

test("the support subject is URL encoded", () => {
  assert.match(
    supportHref("result-outside-slide"),
    /subject=Refused%20upload%20result-outside-slide$/,
  );
});
