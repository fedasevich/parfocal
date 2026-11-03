import assert from "node:assert/strict";
import { test } from "node:test";
import { placeSlideTags } from "../src/screens/review/tag-placement.ts";

const size = { width: 800, height: 600 };

const crowd = ["T1", "T2", "T3", "T4", "T5", "T6"].map((object) => ({ object, text: object }));

const together = (object: string) => {
  const index = crowd.findIndex((tag) => tag.object === object);
  return { left: 400 + index * 5, top: 300 + index * 3 };
};

test("tags that sit on top of each other are moved apart", () => {
  const placed = placeSlideTags(crowd, together, size);
  assert.ok(placed.length > 1);
  for (let one = 0; one < placed.length; one++) {
    for (let two = one + 1; two < placed.length; two++) {
      const a = placed[one];
      const b = placed[two];
      assert.ok(a && b);
      const apart =
        a.left + a.width <= b.left ||
        b.left + b.width <= a.left ||
        a.top + a.height <= b.top ||
        b.top + b.height <= a.top;
      assert.equal(apart, true, `${a.object} and ${b.object}`);
    }
  }
});

test("a tag with no shape on the slide gets no place", () => {
  const placed = placeSlideTags(
    crowd,
    (object) => (object === "T3" ? null : { left: 100, top: 100 + Number(object.slice(1)) * 60 }),
    size,
  );
  assert.equal(
    placed.some((tag) => tag.object === "T3"),
    false,
  );
  assert.equal(placed.length, 5);
});

test("tags outside the shown part of the slide get no place", () => {
  const placed = placeSlideTags(
    crowd,
    (object) => ({ left: object === "T1" ? -50 : 200, top: 100 + Number(object.slice(1)) * 60 }),
    size,
  );
  assert.equal(
    placed.some((tag) => tag.object === "T1"),
    false,
  );
});

test("the box of a placed tag is as wide as its text needs", () => {
  const [short] = placeSlideTags(
    [{ object: "T2", text: "T2" }],
    () => ({ left: 100, top: 100 }),
    size,
  );
  const [long] = placeSlideTags(
    [{ object: "T2", text: "T2 91%" }],
    () => ({ left: 100, top: 100 }),
    size,
  );
  assert.ok(short && long);
  assert.ok(long.width > short.width);
});
