import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fromMentionTokens,
  fromMentionTokensOrNull,
  tokenFor,
  toMentionTokens,
  withMention,
} from "../src/screens/review/mention-picking.ts";

const daniel = { id: "6f1c2a4e-1b2c-4d3e-8f90-0a1b2c3d4e5f", name: "Daniel Hruška" };
const dan = { id: "0b8e7d6c-5a4b-4c3d-9e2f-1a0b9c8d7e6f", name: "Dan" };
const lenka = { id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", name: "Lenka Malá" };
const members = [dan, daniel, lenka];
const names = new Map(members.map((member) => [member.id, member.name]));
const nameOf = (id: string) => names.get(id);

const apiToken =
  /@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g;

test("a picked mention saves as the token the API reads", () => {
  const saved = toMentionTokens(withMention("Runs past the fold @Dan", daniel.name), members);
  assert.equal(saved, `Runs past the fold ${tokenFor(daniel.id)} `);
  assert.deepEqual(
    [...saved.matchAll(apiToken)].map((found) => found[1]),
    [daniel.id],
  );
});

test("the longest name wins and a name inside a longer word is left alone", () => {
  assert.equal(
    toMentionTokens("@Daniel Hruška and @Dan, not @Danny", members),
    `${tokenFor(daniel.id)} and ${tokenFor(dan.id)}, not @Danny`,
  );
  assert.equal(toMentionTokens("@Lenka Maláová", members), "@Lenka Maláová");
});

test("several mentions and punctuation after a name convert", () => {
  assert.equal(
    toMentionTokens("@Lenka Malá: ask @Daniel Hruška.", members),
    `${tokenFor(lenka.id)}: ask ${tokenFor(daniel.id)}.`,
  );
});

test("text without a known name stays as written", () => {
  assert.equal(toMentionTokens("Write to @Someone else", members), "Write to @Someone else");
  assert.equal(toMentionTokens("No mention here", []), "No mention here");
});

test("a token shows as the person's name", () => {
  assert.equal(
    fromMentionTokens(`Runs past the fold, ${tokenFor(daniel.id)} worth a look`, nameOf),
    "Runs past the fold, @Daniel Hruška worth a look",
  );
  assert.equal(
    fromMentionTokens(`${tokenFor(daniel.id.toUpperCase())} look`, nameOf),
    "@Daniel Hruška look",
  );
});

test("an unknown token stays a token and old plain names stay readable", () => {
  const stranger = tokenFor("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
  assert.equal(fromMentionTokens(`ask ${stranger}`, nameOf), `ask ${stranger}`);
  assert.equal(fromMentionTokens("ask @Daniel Hruška", nameOf), "ask @Daniel Hruška");
  assert.equal(fromMentionTokensOrNull(null, nameOf), null);
});

test("saving and showing round-trips the written text", () => {
  const written = "@Lenka Malá agreed, @Daniel Hruška worth a CK level?";
  assert.equal(fromMentionTokens(toMentionTokens(written, members), nameOf), written);
});
