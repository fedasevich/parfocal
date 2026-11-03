import assert from "node:assert/strict";
import { test } from "node:test";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { keyLabeller } from "../src/keys/key-labels.ts";
import {
  railKeyIds,
  railToolOf,
  reviewToolActions,
  routeReviewTool,
  shownReviewTool,
} from "../src/screens/review/review-rail.ts";
import { reviewRail, reviewRailKeys } from "../src/screens/viewer-tools/rails.ts";

const label = keyLabeller(keyRegistry.defs, undefined);
const rail = reviewRail.flat();

test("the review rail holds the five tools with V, H, L, C and S badges", () => {
  assert.deepEqual(
    rail.map((item) => [item.tool, item.action && label(item.action)]),
    [
      ["select", "V"],
      ["hand", "H"],
      ["ruler", "L"],
      ["comment", "C"],
      ["smart", "S"],
    ],
  );
});

test("every rail tool has a key action that picks the same tool", () => {
  for (const item of rail) {
    assert.ok(item.action, item.tool);
    assert.equal(reviewToolActions[item.action], item.tool);
  }
});

test("select, hand and ruler stay in the slide view", () => {
  assert.deepEqual(routeReviewTool("select"), { kind: "stay", tool: undefined });
  assert.deepEqual(routeReviewTool("hand"), { kind: "stay", tool: "hand" });
  assert.deepEqual(routeReviewTool("ruler"), { kind: "stay", tool: "ruler" });
});

test("comment stays and opens the comments tab", () => {
  assert.deepEqual(routeReviewTool("comment"), {
    kind: "stay",
    tool: "comment",
    tab: "comments",
  });
});

test("smart select routes to the Annotate workspace", () => {
  assert.deepEqual(routeReviewTool("smart"), { kind: "annotate", tool: "smart" });
});

test("a tool outside the review rail goes nowhere", () => {
  assert.equal(routeReviewTool("brush"), null);
});

test("the rail shows hand while the slide is idle and select otherwise", () => {
  assert.equal(shownReviewTool(undefined, false), "select");
  assert.equal(shownReviewTool(undefined, true), "hand");
  assert.equal(shownReviewTool("ruler", true), "ruler");
});

test("P opens Annotate and Shift+A picks smart select from the review rail", () => {
  assert.deepEqual(railKeyIds(reviewRail, reviewRailKeys), ["annotate", "aitools"]);
  const press = (action: string) =>
    railToolOf(reviewRail, { action, phase: "press" }, reviewRailKeys);
  assert.equal(press("annotate"), "annotate");
  assert.equal(press("aitools"), "smart");
  assert.deepEqual(routeReviewTool("annotate"), { kind: "annotate", tool: undefined });
});
