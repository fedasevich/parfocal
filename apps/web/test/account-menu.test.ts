import assert from "node:assert/strict";
import { test } from "node:test";
import { commentDraftId, keepDraft, readDraft } from "../src/session/kept-drafts.ts";
import {
  availabilityChange,
  presenceChoices,
  presenceOf,
  shownPerson,
} from "../src/shell/account-presence.ts";
import { shellStore } from "../src/shell/shell-store.ts";

const at = new Date("2026-11-03T10:00:00+01:00");
const mine = { user_id: "u1", until: null, note: null };

test("availability reads as available, away, or available again once the end has passed", () => {
  assert.equal(presenceOf(undefined, at).key, "available");
  assert.equal(presenceOf({ ...mine, status: "available" }, at).label, "Available");
  const away = presenceOf({ ...mine, status: "away", note: "Teaching" }, at);
  assert.deepEqual([away.key, away.label, away.hint], ["away", "Away", "Teaching"]);
  const until = presenceOf({ ...mine, status: "away", until: "2026-11-04T15:00:00+01:00" }, at);
  assert.match(until.label, /^Away until 4 Nov/);
  const busy = presenceOf({ ...mine, status: "busy" }, at);
  assert.deepEqual([busy.key, busy.label, busy.tone], ["busy", "Busy", "bg-warn"]);
  const passed = presenceOf({ ...mine, status: "away", until: "2026-11-02T15:00:00+01:00" }, at);
  assert.equal(passed.key, "available");
});

test("the status dropdown lists every status and changes only to a different one", () => {
  assert.deepEqual(
    presenceChoices.map((choice) => choice.key),
    ["available", "busy", "away"],
  );
  assert.ok(presenceChoices.every((choice) => choice.hint.length > 0));
  assert.deepEqual(availabilityChange("away", { ...mine, status: "available" }, at), {
    status: "away",
  });
  assert.deepEqual(availabilityChange("available", { ...mine, status: "away" }, at), {
    status: "available",
  });
  assert.deepEqual(availabilityChange("busy", { ...mine, status: "available" }, at), {
    status: "busy",
  });
  assert.equal(availabilityChange("busy", { ...mine, status: "busy" }, at), null);
  assert.equal(availabilityChange("available", undefined, at), null);
  assert.equal(availabilityChange("away", { ...mine, status: "away" }, at), null);
});

test("initials only swaps the name for the initials and keeps the rest", () => {
  const person = { name: "Lenka Malá", initials: "LM", color: "#2563eb", role: "Consultant" };
  assert.equal(shownPerson(person, false).name, "Lenka Malá");
  assert.deepEqual(shownPerson(person, true), { ...person, name: "LM" });
});

test("the shell store holds initials only and tells its listeners at once", () => {
  let heard = 0;
  const stop = shellStore.subscribe(() => {
    heard += 1;
  });
  shellStore.setState({ initialsOnly: true });
  assert.equal(shellStore.getState().initialsOnly, true);
  shellStore.reset();
  stop();
  assert.equal(shellStore.getState().initialsOnly, false);
  assert.equal(heard, 2);
});

test("the shell store keeps the sidebar open flag and reset closes it", () => {
  shellStore.setState({ navOpen: true });
  assert.equal(shellStore.getState().navOpen, true);
  assert.equal(shellStore.getState().initialsOnly, false);
  shellStore.reset();
  assert.equal(shellStore.getState().navOpen, false);
});

test("a kept draft belongs to its writer and an empty draft is dropped", () => {
  const values = new Map<string, string>();
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  keepDraft("u1", "comment:t1", "Check the margin");
  assert.equal(readDraft("u1", "comment:t1"), "Check the margin");
  assert.equal(readDraft("u2", "comment:t1"), undefined);
  keepDraft("u1", "comment:t1", "  ");
  assert.equal(readDraft("u1", "comment:t1"), undefined);
  assert.equal(values.size, 0);
});

test("a draft for an object with no thread survives pan and zoom", () => {
  assert.equal(commentDraftId(undefined, "c-12", "/p/1"), "comment:/p/1#c-12");
  assert.equal(commentDraftId("t1", "c-12", "/p/1"), "comment:t1");
});
