import assert from "node:assert/strict";
import { test } from "node:test";
import {
  homeBlocks,
  homeLayoutFor,
  homeLayoutOfSetup,
  sideBlocks,
} from "../src/screens/home/home-layout.ts";

test("with no choice the home follows the workspace role", () => {
  assert.equal(homeLayoutFor("role", "reviewer"), "review");
  assert.equal(homeLayoutFor("role", "researcher"), "research");
  assert.equal(homeLayoutFor("role", undefined), "review");
});

test("the role chosen at setup sets the home", () => {
  assert.equal(homeLayoutOfSetup.rev, "review");
  assert.equal(homeLayoutOfSetup.res, "research");
  assert.equal(homeLayoutOfSetup.both, "both");
});

test("a choice in settings wins over the workspace role", () => {
  assert.equal(homeLayoutFor("research", "reviewer"), "research");
  assert.equal(homeLayoutFor("review", "researcher"), "review");
  assert.equal(homeLayoutFor("both", "reviewer"), "both");
});

test("a reviewer sees continue and tasks first, a researcher projects and Start something", () => {
  assert.deepEqual(homeBlocks.review, ["continue", "projects", "start"]);
  assert.equal(sideBlocks.review[0], "tasks");
  assert.deepEqual(homeBlocks.research.slice(0, 2), ["start", "projects"]);
  assert.equal(sideBlocks.research[0], "week");
  assert.deepEqual(homeBlocks.both, ["continue", "start", "projects"]);
});
