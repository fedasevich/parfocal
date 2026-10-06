import assert from "node:assert/strict";
import { test } from "node:test";
import { packageName } from "../src/index.ts";

test("@parfocal/api-client loads", () => {
  assert.equal(packageName, "@parfocal/api-client");
});
