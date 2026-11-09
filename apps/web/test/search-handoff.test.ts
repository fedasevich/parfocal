import assert from "node:assert/strict";
import { test } from "node:test";
import { destinations } from "../src/shell/destinations.ts";
import { handoffText, searchHandoff } from "../src/shell/search-handoff.ts";

test("the palette hand-off carries the text in state and never in the URL", () => {
  const { href, state } = searchHandoff("Fake Patient 7");
  assert.equal(href, "/search");
  assert.equal(handoffText(state), "Fake Patient 7");
  assert.ok(!href.includes("Fake"));
});

test("the search destination keeps only the scope in the URL", () => {
  assert.equal(destinations.search(), "/search");
  assert.equal(destinations.search("projects"), "/search?scope=projects");
});

test("a missing or foreign state carries no text", () => {
  assert.equal(handoffText(undefined), "");
  assert.equal(handoffText({}), "");
  assert.equal(handoffText({ searchText: 5 }), "");
});
