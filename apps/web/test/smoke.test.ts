import assert from "node:assert/strict";
import { test } from "node:test";
import { packageName } from "../src/index.ts";

test("@parfocal/web loads", () => {
  assert.equal(packageName, "@parfocal/web");
});
