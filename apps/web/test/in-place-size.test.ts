import assert from "node:assert/strict";
import { test } from "node:test";
import { inPlaceSize } from "../src/screens/admin/storage-size.ts";

test("nothing read in place gives no line", () => {
  assert.equal(inPlaceSize(0), null);
});

test("a small amount read in place is shown in its own unit", () => {
  assert.equal(inPlaceSize(0.0004), "0.4 GB");
  assert.equal(inPlaceSize(0.0000004), "0.4 MB");
  assert.equal(inPlaceSize(1.5), "1.5 TB");
});
