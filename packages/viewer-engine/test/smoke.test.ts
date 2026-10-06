import assert from "node:assert/strict";
import { test } from "node:test";
import { packageName } from "../src/index.ts";

test("@parfocal/viewer-engine loads", () => {
  assert.equal(packageName, "@parfocal/viewer-engine");
});
