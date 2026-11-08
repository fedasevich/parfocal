import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestCounts } from "../src/upload/ingest-counts.ts";

test("skipped slides are counted apart and leave the failed count alone", () => {
  const counts = ingestCounts([
    { status: "ready" },
    { status: "failed" },
    { status: "skipped" },
    { status: "skipped" },
    { status: "processing" },
  ]);
  assert.deepEqual(counts, { failed: 1, skipped: 2 });
});
