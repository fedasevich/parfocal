import assert from "node:assert/strict";
import { test } from "node:test";
import { packageName } from "../src/index.ts";

test("@parfocal/test-fixtures loads", () => {
  assert.equal(packageName, "@parfocal/test-fixtures");
});
