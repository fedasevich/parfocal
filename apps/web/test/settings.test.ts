import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction, keyActions } from "../src/screens/settings/keymap.ts";
import { lockAfterText, patientBannerText } from "../src/screens/settings/privacy.ts";
import {
  matchCount,
  matchingRows,
  sectionOfScene,
  shownSection,
  visibleSections,
} from "../src/screens/settings/sections.ts";
import {
  applySafeCombo,
  capture,
  comboOf,
  conflicts,
  currentKeys,
  freshShortcuts,
  pickDirection,
  sceneShortcuts,
  startRecording,
  swap,
  take,
  visibleActions,
} from "../src/screens/settings/shortcuts.ts";

const keysOf = (state: ReturnType<typeof freshShortcuts>, id: string) =>
  currentKeys(state, keyAction(id));

test("the default keymap has no conflicts in the same place", () => {
  assert.deepEqual(conflicts(freshShortcuts()), []);
});

test("the Deciding group lists the keys of every decision style", () => {
  const deciding = keyActions.filter((action) => action.group === "Deciding");
  const notes = deciding.map((action) => action.note ?? "");
  for (const style of [
    "Agree with the AI",
    "Yes or no",
    "5-point certainty",
    "Pick the class blind",
  ]) {
    assert.ok(
      notes.some((note) => note.includes(`in the style ${style}`)),
      `no keys for ${style}`,
    );
  }
  assert.equal(new Set(deciding.map((action) => action.context)).size, 1);
});

test("keys are read by position, so a Czech keyboard keeps the same map", () => {
  assert.deepEqual(comboOf({ key: "ě", code: "Digit2", altKey: true }, true), {
    mods: "⌥",
    key: "2",
  });
  assert.deepEqual(comboOf({ key: "ě", code: "Digit2", altKey: true }, false), {
    mods: "⌥",
    key: "Ě",
  });
  assert.deepEqual(comboOf({ key: "?", code: "Slash", shiftKey: true }, true), {
    mods: "",
    key: "?",
  });
});

test("a free key is taken at once and shows as changed", () => {
  const next = capture(startRecording(freshShortcuts(), "truler", 0), { key: "w", code: "KeyW" });
  assert.deepEqual(keysOf(next.state, "truler"), ["W"]);
  assert.equal(next.state.recording, null);
});

test("a key already used in the same place offers to swap or take it", () => {
  const asked = capture(startRecording(freshShortcuts(), "truler", 0), { key: "m", code: "KeyM" });
  assert.deepEqual(asked.state.pending, { kind: "conflict", combo: "M", other: "tmarker" });
  const swapped = swap(asked.state);
  assert.deepEqual(keysOf(swapped.state, "truler"), ["M"]);
  assert.deepEqual(keysOf(swapped.state, "tmarker"), ["L"]);
  assert.equal(swapped.message, "Ruler is now M, count marker is L");
  const taken = take(asked.state);
  assert.deepEqual(keysOf(taken.state, "truler"), ["M"]);
  assert.deepEqual(keysOf(taken.state, "tmarker"), []);
});

test("the plain and shifted plus record as + and clash with zoom in", () => {
  assert.deepEqual(comboOf({ key: "=", code: "Equal" }, true), { mods: "", key: "+" });
  assert.deepEqual(comboOf({ key: "+", code: "Equal", shiftKey: true }, true), {
    mods: "",
    key: "+",
  });
  const asked = capture(startRecording(freshShortcuts(), "fit", 0), { key: "=", code: "Equal" });
  assert.deepEqual(asked.state.pending, { kind: "conflict", combo: "+", other: "zoomin" });
});

test("the same key in another place is fine", () => {
  const next = capture(startRecording(freshShortcuts(), "dnext", 0), { key: "l", code: "KeyL" });
  assert.equal(next.state.pending, null);
  assert.deepEqual(keysOf(next.state, "dnext"), ["L"]);
});

test("a key the browser keeps is refused", () => {
  const next = capture(startRecording(freshShortcuts(), "tcomment", 0), {
    key: "w",
    code: "KeyW",
    metaKey: true,
  });
  assert.deepEqual(next.state.pending, { kind: "reserved", combo: "⌘W" });
  assert.deepEqual(keysOf(next.state, "tcomment"), ["C"]);
});

test("signing out needs ⌘ or ⌃", () => {
  const asked = capture(startRecording(freshShortcuts(), "signout", 0), { key: "s", code: "KeyS" });
  assert.deepEqual(asked.state.pending, { kind: "safe", combo: "S" });
  assert.deepEqual(keysOf(applySafeCombo(asked.state), "signout"), ["⌘S"]);
});

test("sets change as sets", () => {
  const range = capture(startRecording(freshShortcuts(), "mag", 0), {
    key: "Control",
    ctrlKey: true,
  });
  assert.deepEqual(keysOf(range.state, "mag"), ["⌘1 … ⌘6"]);
  const sequence = capture(startRecording(freshShortcuts(), "area", 0), { key: "j", code: "KeyJ" });
  assert.deepEqual(keysOf(sequence.state, "area"), ["J then 1 … 9"]);
  const clash = pickDirection(startRecording(freshShortcuts(), "pan", 0), "pan", "WASD");
  assert.equal(clash.pending?.kind, "dirclash");
  assert.deepEqual(
    pickDirection(startRecording(freshShortcuts(), "pan", 0), "pan", "IJKL").pending,
    { kind: "dirclash", value: "IJKL", names: ["ruler (L)", "show or hide the panel (I)"] },
  );
  const moved = { ...freshShortcuts(), custom: { panel: ["⇧I"], truler: ["D"] } };
  assert.deepEqual(keysOf(pickDirection(moved, "pan", "IJKL"), "pan"), ["IJKL"]);
});

test("Esc cancels and ⌫ removes the key being recorded", () => {
  const recording = startRecording(freshShortcuts(), "truler", 0);
  assert.equal(capture(recording, { key: "Escape" }).state.recording, null);
  assert.deepEqual(keysOf(capture(recording, { key: "Backspace" }).state, "truler"), []);
});

test("pressing a key while finding shows what it does", () => {
  const finding = { ...freshShortcuts(), finding: true };
  const found = capture(finding, { key: "l", code: "KeyL" }).state;
  assert.equal(found.findKey, "L");
  assert.deepEqual(
    visibleActions(found, "").map((action) => action.id),
    ["truler"],
  );
});

test("each shortcut scene sets the state the mock shows", () => {
  const base = freshShortcuts();
  assert.equal(sceneShortcuts("changed", base).filter, "changed");
  assert.equal(visibleActions(sceneShortcuts("changed", base), "").length, 3);
  assert.equal(sceneShortcuts("conflict", base).pending?.kind, "conflict");
  assert.equal(sceneShortcuts("reserved", base).pending?.kind, "reserved");
  assert.equal(sceneShortcuts("safety", base).pending?.kind, "safe");
  assert.equal(sceneShortcuts("findkey", base).findKey, "L");
});

test("searching for zoom keeps the zoom rows and the shortcuts", () => {
  assert.deepEqual(
    visibleSections("zoom").map((section) => section.key),
    ["layout", "navigation", "shortcuts"],
  );
  assert.deepEqual(
    matchingRows("navigation", "zoom").map((row) => row.key),
    ["wheel", "speed", "invertZoom", "zoomAnchor", "objectiveDetents"],
  );
  assert.equal(matchCount("navigation", "zoom"), 5);
  assert.equal(shownSection("display", "zoom")?.key, "layout");
  assert.equal(shownSection("navigation", "zoom")?.key, "navigation");
  assert.equal(shownSection("display", "nothing like this"), undefined);
  assert.equal(sectionOfScene("search"), "navigation");
  assert.equal(sectionOfScene("conflict"), "shortcuts");
});

test("the Privacy section lists initials, lock after, patient banner and other devices", () => {
  assert.deepEqual(
    matchingRows("privacy", "").map((item) => [item.key, item.scope]),
    [
      ["initials", "personal"],
      ["analytics", "personal"],
      ["lockAfter", "lab"],
      ["patientBanner", "lab"],
      ["otherDevices", "personal"],
    ],
  );
});

test("lock after reads the lab idle minutes", () => {
  assert.equal(lockAfterText(15), "15 min");
  assert.equal(lockAfterText(undefined), "");
});

test("the patient banner row reads the lab setting", () => {
  assert.equal(patientBannerText(undefined), "Shown with full name");
  assert.equal(
    patientBannerText({ values: { patient_banner: true, patient_names: "initials" }, locked: [] }),
    "Shown with initials only",
  );
  assert.equal(patientBannerText({ values: { patient_banner: false }, locked: [] }), "Hidden");
});
