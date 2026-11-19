import assert from "node:assert/strict";
import { test } from "node:test";
import { newestVersion, parseReleases } from "../src/help/release-notes.ts";

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

const mixed = `## v0.5.0 (2026-11-19)

### Features

- PROTO-031: Settings rows draw and preview what they do
- PROTO-044: Merge the lead and share one Whole slide button
- TEST-048: Seed the 13 gigapixel TIFF in the format gallery
- Show the case in the slides popover (PROTO-042)
- Show the case in the slides popover

### Fixes

- PROTO-047: Make main's CI green after the drift merges
- PROTO-034: Keep the next object within budget after a decision

### Docs

- PROTO-030: Claim PROTO-030 PROTO-031 for the parallel run

### Tests

- PROTO-049: Test every quiet text token

### Other

- chore stuff

## v0.4.0 (2026-11-18)

### Docs

- Write more docs
`;

test("keeps only user facing sentences without task codes or duplicates", () => {
  const releases = parseReleases(mixed);
  assert.equal(releases.length, 1);
  assert.deepEqual(releases[0]?.notes, [
    "Settings rows draw and preview what they do",
    "Show the case in the slides popover",
    "Keep the next object within budget after a decision",
  ]);
});

test("reads the newest version even when its notes are all internal", () => {
  assert.equal(newestVersion("## v0.9.0 (2026-11-19)\n\n### Docs\n\n- Claim it\n"), "v0.9.0");
  assert.equal(newestVersion("# Changelog\n"), "");
});
