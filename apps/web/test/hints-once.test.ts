import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hintLeftBehind } from "../src/annotations/hints-once.ts";

describe("tool hints seen once", () => {
  it("marks nothing while the same tool stays and the workspace settles", () => {
    assert.equal(hintLeftBehind(null, "select"), null);
    assert.equal(hintLeftBehind("select", "select"), null);
  });

  it("marks the shown hint only when the person moves to another tool", () => {
    assert.equal(hintLeftBehind("select", "ruler"), "viewer.tool.select");
  });

  it("marks nothing for a tool whose hint was never shown", () => {
    assert.equal(hintLeftBehind(null, "ruler"), null);
  });
});
