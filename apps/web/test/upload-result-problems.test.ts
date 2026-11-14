import assert from "node:assert/strict";
import { test } from "node:test";
import {
  openResultProblems,
  type ResultUpload,
} from "../src/screens/upload/result-problems-model.ts";

const upload = (status: string, reason: string | null): ResultUpload => ({
  uploadId: reason ?? status,
  name: "cells.csv",
  status,
  reason,
  message: null,
});

test("result files that wait for a choice or ended as a heatmap count as open problems", () => {
  assert.equal(
    openResultProblems([
      upload("waiting", "needs-choices"),
      upload("failed", "result-heatmap-not-stored"),
      upload("ready", null),
      upload("processing", null),
      upload("waiting", "needs-slide"),
    ]),
    2,
  );
  assert.equal(openResultProblems([upload("ready", null)]), 0);
});
