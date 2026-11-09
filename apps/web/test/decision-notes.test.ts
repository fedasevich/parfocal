import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import {
  fold,
  type Mentionable,
  mentionOptions,
  mentionQuery,
  withMention,
} from "../src/screens/review/mention-picking.ts";
import {
  draftFrom,
  emptyNote,
  hasNote,
  noteKeyAction,
  noteLimit,
  reasonBody,
  toggleReason,
  tooLong,
  withNote,
} from "../src/screens/review/note-model.ts";
import type { Answer } from "../src/screens/review/review-state.ts";

const region: ReviewObject = {
  object: "T5",
  kind: "region",
  number: 5,
  class_name: "Tumor",
  score: 0.8,
  size_mm: 0.4,
  other_class: null,
};

const decided = (value: Answer["value"], reasons: string[] = []): Answer => ({
  value,
  raw: value,
  reasons,
  note: null,
});

const person = { name: "X", initials: "X", color: "#000" };

const members: Mentionable[] = [
  { id: "u1", name: "Daniel Hruška", person, sub: "Pathologist" },
  { id: "u2", name: "Anna Kopecká", person, sub: "" },
  { id: "me", name: "Lenka Marková", person, sub: "" },
];

for (const value of ["agree", "disagree", "unsure"] as const) {
  test(`writing, editing and cancelling a note on ${value}`, () => {
    const kept = decided(value);
    const written = withNote(kept, { reasons: [], text: "  Edge is folded  " });
    assert.equal(written.note, "Edge is folded");
    assert.equal(written.value, value);
    assert.equal(hasNote(written), true);

    const editing = draftFrom(written);
    assert.equal(editing.text, "Edge is folded");
    const edited = withNote(written, { ...editing, text: "Edge is folded near the capsule" });
    assert.equal(edited.note, "Edge is folded near the capsule");

    assert.equal(kept.note, null);
    assert.equal(withNote(written, emptyNote).note, null);
    assert.equal(hasNote(withNote(written, emptyNote)), false);
  });
}

test("quick reasons toggle on and off and none is required", () => {
  let draft = emptyNote;
  draft = toggleReason(draft, "Boundary is off");
  draft = toggleReason(draft, "Artefact or fold");
  assert.deepEqual(draft.reasons, ["Boundary is off", "Artefact or fold"]);
  draft = toggleReason(draft, "Boundary is off");
  assert.deepEqual(draft.reasons, ["Artefact or fold"]);
  const saved = withNote(decided("disagree"), emptyNote);
  assert.deepEqual(saved.reasons, []);
  assert.equal(saved.note, null);
});

test("quick reasons turn into the codes the API stores", () => {
  const classes = [{ id: "c1", name: "Tumor", key: "t", color: "#e11d48" }];
  assert.deepEqual(
    reasonBody(["Boundary is off", "Artefact or fold"], "disagree", region, classes),
    { reasons: ["boundary_off", "artefact"], reason_class_id: null },
  );
  assert.deepEqual(reasonBody(["Need IHC", "Out of focus"], "unsure", region, classes), {
    reasons: ["need_ihc", "out_of_focus"],
    reason_class_id: null,
  });
  assert.deepEqual(reasonBody(["Need a second look"], "unsure", region, classes).reasons, [
    "need_second_look",
  ]);
  assert.deepEqual(reasonBody(["Boundary is off"], "agree", region, classes).reasons, []);
});

test("Enter saves, Shift+Enter writes a line, Esc cancels and IME composing is left alone", () => {
  assert.equal(noteKeyAction("Enter", false, false, false), "save");
  assert.equal(noteKeyAction("Enter", true, false, false), "none");
  assert.equal(noteKeyAction("Escape", false, false, false), "cancel");
  assert.equal(noteKeyAction("Enter", false, true, false), "none");
  assert.equal(noteKeyAction("a", false, false, false), "none");
});

test("a note longer than 500 characters cannot be saved", () => {
  assert.equal(tooLong({ reasons: [], text: "x".repeat(noteLimit) }), false);
  assert.equal(tooLong({ reasons: [], text: "x".repeat(noteLimit + 1) }), true);
});

test("typing @ offers people by any word of their name and ignores accents", () => {
  assert.equal(mentionQuery("Check with @Dan"), "Dan");
  assert.equal(mentionQuery("no mention here"), undefined);
  assert.equal(fold("Hruška"), "hruska");
  assert.deepEqual(
    mentionOptions("see @hru", members, "me", []).map((option) => option.id),
    ["u1"],
  );
  assert.deepEqual(
    mentionOptions("see @", members, "me", []).map((option) => option.id),
    ["u1", "u2"],
  );
});

test("a blinded reviewer is listed but cannot be picked", () => {
  const options = mentionOptions("@ann", members, "me", ["u2"]);
  assert.equal(options[0]?.disabledReason, "Reviews this task blind");
});

test("picking a person replaces the typed word with the name", () => {
  assert.equal(withMention("Ask @Dan", "Daniel Hruška"), "Ask @Daniel Hruška ");
});
