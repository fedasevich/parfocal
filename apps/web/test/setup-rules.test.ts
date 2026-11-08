import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstDestination,
  personalValuesOf,
  recommendedFirst,
  shortcutPresetOf,
  wheelModeOf,
  workspaceMoveOf,
} from "../src/screens/onboarding/setup-rules.ts";

test("each role sets the home layout and the recommended first project", () => {
  assert.equal(personalValuesOf({ role: "res", viewer: "Parfocal" }).home_layout, "research");
  assert.equal(personalValuesOf({ role: "rev", viewer: "Parfocal" }).home_layout, "review");
  assert.equal(personalValuesOf({ role: "both", viewer: "Parfocal" }).home_layout, "both");
  assert.equal(recommendedFirst("res"), "create");
  assert.equal(recommendedFirst("rev"), "sample");
  assert.equal(recommendedFirst("both"), "sample");
});

test("the viewer you are used to picks the shortcut preset", () => {
  assert.equal(shortcutPresetOf("QuPath"), "qupath");
  assert.equal(shortcutPresetOf("Parfocal"), "default");
  assert.equal(shortcutPresetOf("Sectra"), "default");
  assert.equal(personalValuesOf({ role: "rev", viewer: "QuPath" }).shortcut_preset, "qupath");
});

test("a trackpad pans with the wheel and every other device zooms", () => {
  assert.equal(wheelModeOf("trackpad"), "pan");
  for (const device of ["mouse", "spacemouse", "gamepad", "pen", "keyboard"] as const) {
    assert.equal(wheelModeOf(device), "zoom");
  }
});

test("the workspace choice becomes a join, a request or a new workspace", () => {
  const base = { matchedId: "a", askedId: "b", name: "", mode: "deid" } as const;
  assert.deepEqual(workspaceMoveOf({ ...base, picked: "a" }), { kind: "join", workspaceId: "a" });
  assert.deepEqual(workspaceMoveOf({ ...base, picked: "b" }), { kind: "ask", workspaceId: "b" });
  assert.deepEqual(workspaceMoveOf({ ...base, picked: "" }), { kind: "none" });
  assert.deepEqual(workspaceMoveOf({ ...base, picked: "new" }), { kind: "none" });
  assert.deepEqual(workspaceMoveOf({ ...base, picked: "new", name: " Brno lab " }), {
    kind: "create",
    name: "Brno lab",
    privacy: "de-identified",
  });
  assert.deepEqual(workspaceMoveOf({ ...base, picked: "new", name: "Brno", mode: "clin" }), {
    kind: "create",
    name: "Brno",
    privacy: "clinical",
  });
});

test("setup ends in the place of the chosen first project", () => {
  assert.equal(firstDestination("sample", "p-1"), "/projects/p-1");
  assert.equal(firstDestination("create"), "/projects/new");
  assert.equal(firstDestination("wait"), "/");
  assert.equal(firstDestination("sample"), "/");
});
