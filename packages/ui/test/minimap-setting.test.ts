import assert from "node:assert/strict";
import { test } from "node:test";
import { type MinimapSize, shownMinimap } from "../src/lib/minimap-box.ts";

const sizes: MinimapSize[] = ["full", "compact", "pip", "travel"];

test("when useful hides the map while more than half of the tissue is on screen", () => {
  assert.equal(shownMinimap("useful", "hidden"), null);
  for (const size of sizes) assert.equal(shownMinimap("useful", size), size);
});

test("always shows the reading map where when useful would hide it", () => {
  assert.equal(shownMinimap("always", "hidden"), "full");
  for (const size of sizes) assert.equal(shownMinimap("always", size), size);
});

test("never shows no map in any mode", () => {
  for (const mode of ["hidden", ...sizes] as const) assert.equal(shownMinimap("never", mode), null);
});
