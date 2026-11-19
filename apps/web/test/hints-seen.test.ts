import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checklistHintId,
  foldLegacyHints,
  guestHintsKey,
  guidedCoachHintId,
  hintWrites,
  legacyHintIds,
  mostHints,
  noteHintsSeen,
  readGuestHints,
  toolHintId,
  withoutSeen,
  withSeen,
  writeGuestHints,
} from "../src/hints/hints-seen.ts";
import { hintId, sectionRows, showsOnce } from "../src/screens/settings/sections.ts";

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    removeItem: (key: string) => void items.delete(key),
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

  it("folds the old device keys into the one list and removes them", () => {
    const storage = memory({
      "parfocal.tool-hints-seen": '["ruler", "polygon"]',
      "parfocal.guided-coach": '{"user-a": true}',
      "parfocal.checklist-tried": '["open-sample"]',
      [guestHintsKey]: '["settings.tools"]',
    });
    assert.deepEqual(legacyHintIds(storage), [
      toolHintId("ruler"),
      toolHintId("polygon"),
      guidedCoachHintId,
      checklistHintId("open-sample"),
    ]);
    foldLegacyHints(storage);
    assert.deepEqual(readGuestHints(storage), [
      "settings.tools",
      "viewer.tool.ruler",
      "viewer.tool.polygon",
      "coach.guided",
      "checklist.open-sample",
    ]);
    assert.equal(storage.getItem("parfocal.tool-hints-seen"), null);
    assert.equal(storage.getItem("parfocal.guided-coach"), null);
    assert.equal(storage.getItem("parfocal.checklist-tried"), null);
    foldLegacyHints(storage);
    assert.equal(readGuestHints(storage).length, 5);
  });

  it("reads damaged or dismissed-by-nobody old keys as nothing", () => {
    assert.deepEqual(
      legacyHintIds(
        memory({
          "parfocal.tool-hints-seen": "not json",
          "parfocal.guided-coach": '{"user-a": false}',
          "parfocal.checklist-tried": "{}",
        }),
      ),
      [],
    );
    assert.deepEqual(legacyHintIds(memory({ "parfocal.guided-coach": "[1]" })), []);
  });

  it("notes a hint once and forgets all of them on reset", () => {
    const storage = memory();
    noteHintsSeen(["coach.guided"], storage);
    noteHintsSeen(["coach.guided", "viewer.tool.ruler"], storage);
    assert.deepEqual(readGuestHints(storage), ["coach.guided", "viewer.tool.ruler"]);
    writeGuestHints([], storage);
    assert.deepEqual(readGuestHints(storage), []);
  });

  it("closing a tool hint keeps it seen and showing it again from Help clears only that one", () => {
    const storage = memory();
    noteHintsSeen([toolHintId("rect"), toolHintId("smart")], storage);
    assert.deepEqual(readGuestHints(storage), ["viewer.tool.rect", "viewer.tool.smart"]);
    writeGuestHints(withoutSeen(readGuestHints(storage), [toolHintId("rect")]), storage);
    assert.deepEqual(readGuestHints(storage), ["viewer.tool.smart"]);
    assert.deepEqual(withoutSeen(["a"], ["b"]), ["a"]);
  });

  it("sends quick hint saves one at a time and builds each on the one before", async () => {
    const sent: string[][] = [];
    const releases: (() => void)[] = [];
    let settled = 0;
    const writes = hintWrites((ids) => {
      sent.push(ids);
      return new Promise<void>((resolve) => releases.push(resolve));
    });
    const mark = (id: string) =>
      writes.push(withSeen(writes.pending() ?? [], [id]), () => {
        settled += 1;
      });
    const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

    mark("viewer.tool.ruler");
    mark("viewer.tool.arrow");
    await turn();
    assert.deepEqual(sent, [["viewer.tool.ruler"]]);
    assert.deepEqual(writes.pending(), ["viewer.tool.ruler", "viewer.tool.arrow"]);

    releases[0]?.();
    await turn();
    assert.deepEqual(sent[1], ["viewer.tool.ruler", "viewer.tool.arrow"]);
    assert.equal(settled, 0);
    mark("viewer.tool.text");

    releases[1]?.();
    await turn();
    releases[2]?.();
    await turn();
    assert.deepEqual(sent[2], ["viewer.tool.ruler", "viewer.tool.arrow", "viewer.tool.text"]);
    assert.equal(settled, 1);
    assert.equal(writes.pending(), null);
  });

  it("a failed hint save still lets the next one through", async () => {
    const sent: string[][] = [];
    let settled = 0;
    const writes = hintWrites((ids) => {
      sent.push(ids);
      return sent.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve();
    });
    writes.push(["a"], () => {
      settled += 1;
    });
    writes.push(["a", "b"], () => {
      settled += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(sent, [["a"], ["a", "b"]]);
    assert.equal(settled, 1);
  });
});
