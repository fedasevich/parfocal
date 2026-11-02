import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PART_BYTES, MAX_PARTS, MIB, partSizeFor } from "../src/upload/part-size.ts";

const GIB = 1024 * MIB;

test("files up to 156.25 GiB use the 16 MiB default, as the API does", () => {
  assert.equal(partSizeFor(1), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(4 * GIB), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(7 * GIB), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(100 * GIB), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(MAX_PARTS * DEFAULT_PART_BYTES), DEFAULT_PART_BYTES);
});

test("larger files grow the part to a whole MiB so they stay within 10,000 parts", () => {
  const fileBytes = MAX_PARTS * DEFAULT_PART_BYTES + 1;
  const partBytes = partSizeFor(fileBytes);
  assert.equal(partBytes, 17 * MIB);
  assert.ok(Math.ceil(fileBytes / partBytes) <= MAX_PARTS);
});

test("bad sizes are refused", () => {
  assert.throws(() => partSizeFor(0), RangeError);
  assert.throws(() => partSizeFor(1.5), RangeError);
  assert.throws(() => partSizeFor(10, 4 * MIB), RangeError);
  assert.throws(() => partSizeFor(10, 16 * MIB + 1), RangeError);
  assert.throws(() => partSizeFor(MAX_PARTS * 5 * 1024 * MIB + 1), RangeError);
});
