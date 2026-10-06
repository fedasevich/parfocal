import assert from "node:assert/strict";
import { test } from "node:test";
import { packageName } from "../src/index.ts";

test("@parfocal/tokens loads", () => {
  assert.equal(packageName, "@parfocal/tokens");
});
