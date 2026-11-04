import assert from "node:assert/strict";
import { test } from "node:test";
import {
  railHasTool,
  resolveWorkspace,
  showsCountPanel,
  workspaceSetups,
} from "../src/viewer/workspace.ts";

test("an annotate task opens in Annotate and a review task opens in Review", () => {
  assert.equal(resolveWorkspace(undefined, "annotate"), "annotate");
  assert.equal(resolveWorkspace(undefined, "review"), "review");
});

test("a slide with no task opens in Annotate and a chosen workspace wins", () => {
  assert.equal(resolveWorkspace(undefined, undefined), "annotate");
  assert.equal(resolveWorkspace("review", "annotate"), "review");
  assert.equal(resolveWorkspace("annotate", "review"), "annotate");
});

test("Review pans on drag and Annotate draws a marquee on drag", () => {
  assert.equal(workspaceSetups.review.dragBehaviour, "pan");
  assert.equal(workspaceSetups.review.restingTool, "hand");
  assert.equal(workspaceSetups.annotate.dragBehaviour, "marquee");
  assert.equal(workspaceSetups.annotate.restingTool, "select");
});

test("the rail follows the workspace and drawing tools live only in Annotate", () => {
  for (const tool of ["poly", "free", "rect", "ellipse", "marker", "brush", "auto"]) {
    assert.equal(railHasTool(workspaceSetups.review, tool), false, tool);
    assert.equal(railHasTool(workspaceSetups.annotate, tool), true, tool);
  }
  for (const tool of ["select", "hand", "ruler", "comment", "smart"]) {
    assert.equal(railHasTool(workspaceSetups.review, tool), true, tool);
    assert.equal(railHasTool(workspaceSetups.annotate, tool), true, tool);
  }
});

test("the count panel opens with the marker tool in Annotate and only with markers in Review", () => {
  const counting = { counting: true, markers: 0 };
  const placed = { counting: false, markers: 2 };
  const idle = { counting: false, markers: 0 };
  assert.equal(showsCountPanel(workspaceSetups.annotate, counting), true);
  assert.equal(showsCountPanel(workspaceSetups.review, counting), false);
  assert.equal(showsCountPanel(workspaceSetups.review, placed), true);
  assert.equal(showsCountPanel(workspaceSetups.annotate, idle), false);
});
