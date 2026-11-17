import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  guestHintsKey,
  mostHints,
  readGuestHints,
  withSeen,
  writeGuestHints,
} from "../src/hints/hints-seen.ts";
import { hintId, sectionRows, showsOnce } from "../src/screens/settings/sections.ts";

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe("hints seen", () => {
  it("adds new hints once and keeps the order they were seen in", () => {
    assert.deepEqual(withSeen(["settings.theme"], ["settings.tools", "settings.theme"]), [
      "settings.theme",
      "settings.tools",
    ]);
  });

  it("keeps only the latest hints when the list is full", () => {
    const full = Array.from({ length: mostHints }, (_, index) => `hint.${index}`);
    const next = withSeen(full, ["settings.tools"]);
    assert.equal(next.length, mostHints);
    assert.equal(next.at(-1), "settings.tools");
    assert.equal(next[0], "hint.1");
  });

  it("keeps a guest's hints in this browser and ignores what it cannot read", () => {
    const storage = memory();
    writeGuestHints(["settings.tools"], storage);
    assert.deepEqual(readGuestHints(storage), ["settings.tools"]);
    assert.deepEqual(readGuestHints(memory({ [guestHintsKey]: "not json" })), []);
    assert.deepEqual(readGuestHints(memory({ [guestHintsKey]: '[1, "", "a"]' })), ["a"]);
  });

  it("shows a row's explanation once but keeps lab reasons and live lines every time", () => {
    const rows = Object.values(sectionRows).flat();
    const once = (key: string) => {
      const row = rows.find((item) => item.key === key);
      assert.ok(row, key);
      return showsOnce(row);
    };
    assert.equal(once("tools"), true);
    assert.equal(once("decisionCutoff"), false);
    assert.equal(once("lockAfter"), false);
    assert.equal(once("otherDevices"), false);
    assert.equal(once("hints"), false);
    assert.equal(hintId("tools"), "settings.tools");
  });
});
