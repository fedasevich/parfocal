import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PART_BYTES,
  MAX_PARTS,
  MIB,
  partSizeFor,
  partsProblem,
  planParts,
} from "#part-size.ts";

const GIB = 1024 * MIB;

test("files up to 156.25 GiB use the 16 MiB default", () => {
  assert.equal(partSizeFor(1), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(4 * GIB), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(7 * GIB), DEFAULT_PART_BYTES);
  assert.equal(partSizeFor(MAX_PARTS * DEFAULT_PART_BYTES), DEFAULT_PART_BYTES);
});

test("larger files grow the part to a whole MiB so they stay within 10,000 parts", () => {
  const fileBytes = MAX_PARTS * DEFAULT_PART_BYTES + 1;
  const partBytes = partSizeFor(fileBytes);
  assert.equal(partBytes, 17 * MIB);
  assert.ok(planParts(fileBytes, partBytes).partCount <= MAX_PARTS);
});

test("a 4 GiB file is 256 parts of 16 MiB with a full last part", () => {
  assert.deepEqual(planParts(4 * GIB, DEFAULT_PART_BYTES), {
    partBytes: DEFAULT_PART_BYTES,
    partCount: 256,
    lastPartBytes: DEFAULT_PART_BYTES,
  });
});

test("an odd size gets a short last part", () => {
  const plan = planParts(40 * MIB + 3, DEFAULT_PART_BYTES);
  assert.equal(plan.partCount, 3);
  assert.equal(plan.lastPartBytes, 8 * MIB + 3);
});

test("bad sizes are refused", () => {
  assert.throws(() => partSizeFor(0), RangeError);
  assert.throws(() => partSizeFor(10, 4 * MIB), RangeError);
  assert.throws(() => partSizeFor(10, 16 * MIB + 1), RangeError);
  assert.throws(() => partSizeFor(MAX_PARTS * 5 * 1024 * MIB + 1), RangeError);
  assert.throws(() => planParts(MAX_PARTS * MIB + 1, MIB), RangeError);
});

test("uniform parts pass and anything R2 would refuse is named", () => {
  const fileBytes = 40 * MIB + 3;
  const good = [
    { partNumber: 2, size: 16 * MIB },
    { partNumber: 1, size: 16 * MIB },
    { partNumber: 3, size: 8 * MIB + 3 },
  ];
  assert.equal(partsProblem(good, fileBytes, DEFAULT_PART_BYTES), null);
  assert.equal(
    partsProblem(good.slice(0, 2), fileBytes, DEFAULT_PART_BYTES),
    "expected 3 parts, found 2",
  );
  assert.equal(
    partsProblem(
      [
        { partNumber: 1, size: 16 * MIB },
        { partNumber: 2, size: 15 * MIB },
        { partNumber: 3, size: 9 * MIB + 3 },
      ],
      fileBytes,
      DEFAULT_PART_BYTES,
    ),
    `part 2 has ${15 * MIB} bytes, expected ${16 * MIB}`,
  );
  assert.equal(
    partsProblem(
      [
        { partNumber: 1, size: 16 * MIB },
        { partNumber: 3, size: 16 * MIB },
        { partNumber: 4, size: 8 * MIB + 3 },
      ],
      fileBytes,
      DEFAULT_PART_BYTES,
    ),
    "part 2 is missing",
  );
});
