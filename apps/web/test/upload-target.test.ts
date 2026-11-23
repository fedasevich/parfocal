import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadProjectId } from "../src/shell/destinations.ts";

test("the top bar upload stays in the open project", () => {
  assert.equal(uploadProjectId("p4", "p1"), "p4");
});

test("the top bar upload falls back to the first project", () => {
  assert.equal(uploadProjectId(undefined, "p1"), "p1");
});
