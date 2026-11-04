import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPresence, roomSocketUrl, viewersOf } from "../src/presence/presence-state.ts";

const none = new Map();

test("joins and leaves keep one entry per person and skip me", () => {
  let present = nextPresence(none, { kind: "presence.joined", ids: { user: "ben" } }, "anna");
  present = nextPresence(present, { kind: "presence.joined", ids: { user: "ben" } }, "anna");
  present = nextPresence(present, { kind: "presence.joined", ids: { user: "anna" } }, "anna");
  assert.deepEqual(viewersOf(present), ["ben"]);
  present = nextPresence(present, { kind: "presence.left", ids: { user: "ben" } }, "anna");
  assert.deepEqual(viewersOf(present), []);
});

test("the project room keeps viewers per slide", () => {
  let present = nextPresence(
    none,
    { kind: "presence.joined", ids: { slide: "s1", user: "ben" } },
    "anna",
  );
  present = nextPresence(present, { kind: "presence.joined", ids: { user: "cleo" } }, "anna");
  assert.deepEqual(viewersOf(present, "s1"), ["ben"]);
  assert.deepEqual(viewersOf(present, "s2"), []);
  present = nextPresence(
    present,
    { kind: "presence.left", ids: { slide: "s1", user: "ben" } },
    "anna",
  );
  assert.deepEqual(viewersOf(present, "s1"), []);
});

test("other events change nothing and the socket follows the page scheme", () => {
  const present = nextPresence(none, { kind: "slide.changed", ids: { user: "ben" } }, "anna");
  assert.equal(present, none);
  assert.equal(
    roomSocketUrl("slide:1", { protocol: "https:", host: "parfocal.eu" }),
    "wss://parfocal.eu/rt/slide:1",
  );
  assert.equal(
    roomSocketUrl("slide:1", { protocol: "http:", host: "localhost:5197" }),
    "ws://localhost:5197/rt/slide:1",
  );
});
