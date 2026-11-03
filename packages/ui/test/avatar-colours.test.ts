import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avatarColour,
  avatarColours,
  contrast,
  personFromProfile,
  readableOn,
} from "../src/lib/avatar-colours.ts";

test("the profile colour index picks a palette colour and wraps", () => {
  assert.equal(avatarColour(0), avatarColours[0]);
  assert.equal(avatarColour(8), avatarColours[8]);
  assert.equal(avatarColour(9), avatarColours[0]);
  assert.equal(avatarColour(-1), avatarColours[8]);
  assert.equal(avatarColour(2.7), avatarColours[2]);
  assert.equal(avatarColour(Number.NaN), avatarColours[0]);
});

test("a profile becomes a person with its colour, name and title", () => {
  assert.deepEqual(
    personFromProfile({
      display_name: "Test Person",
      initials: "TP",
      avatar_colour: 4,
      title: "Researcher",
    }),
    { name: "Test Person", initials: "TP", color: avatarColours[4], role: "Researcher" },
  );
});

test("a profile without a colour or title falls back to the first colour and no role", () => {
  const person = personFromProfile({
    display_name: "Test Person",
    initials: "TP",
    avatar_colour: null,
    title: null,
  });
  assert.equal(person.color, avatarColours[0]);
  assert.equal("role" in person, false);
});

test("initials on every profile colour pass normal text contrast", () => {
  for (const colour of avatarColours) {
    assert.ok(contrast(colour, readableOn(colour)) >= 4.5, colour);
  }
});

test("readable text picks the darker ink on a light background", () => {
  assert.equal(readableOn("#fde68a"), "#0b0b0b");
  assert.equal(readableOn("#1e293b"), "#ffffff");
});
