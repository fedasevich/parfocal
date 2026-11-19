import assert from "node:assert/strict";
import { test } from "node:test";
import { resultSetStates } from "../src/viewer/result-set-state.ts";

const set = (name: string, status: "importing" | "ready" | "failed") => ({
  name,
  model_version: "v1.0",
  status,
});

test("ready result sets need no notice", () => {
  assert.equal(resultSetStates([]), null);
  assert.equal(resultSetStates([set("CAMELYON", "ready")]), null);
});

test("importing and failed result sets are named for the viewer notice", () => {
  assert.deepEqual(
    resultSetStates([
      set("CAMELYON", "importing"),
      set("HoVer-Net", "failed"),
      set("StarDist", "ready"),
      { name: "Upload", model_version: null, status: "failed" },
    ]),
    { importing: ["CAMELYON v1.0"], failed: ["HoVer-Net v1.0", "Upload"] },
  );
});
