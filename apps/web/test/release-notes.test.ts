import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReleases } from "../src/help/release-notes.ts";

const changelog = `# Changelog

## v0.3.1 (2026-11-16)

### Fixes

- TEST-020: Lift the guard

## v0.3.0 (2026-11-16)

### Features

- OPS-002: Run local dev on Postgres 18
- Plain note

## v0.2.0 (2026-11-01)

- Old
`;

test("reads the newest releases with task codes removed from each note", () => {
  const releases = parseReleases(changelog, 2);
  assert.equal(releases.length, 2);
  assert.deepEqual(releases[0], {
    version: "v0.3.1",
    date: "2026-11-16",
    notes: ["Lift the guard"],
  });
  assert.deepEqual(releases[1]?.notes, ["Run local dev on Postgres 18", "Plain note"]);
});

test("returns nothing when the text has no release headings", () => {
  assert.deepEqual(parseReleases("# Changelog\n", 2), []);
});
