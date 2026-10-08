import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultGroups,
  fixturesDir,
  loadManifest,
  localFixtureDirs,
  parseManifest,
  selectFixtures,
  sha256Of,
  syntheticDir,
  syntheticPath,
} from "../src/index.ts";

const manifest = loadManifest();

test("every group has fixtures and the default group stays small", () => {
  for (const group of ["small", "formats", "big", "huge", "camelyon"]) {
    assert.ok(selectFixtures(manifest, [group]).length > 0, group);
  }
  const small = selectFixtures(manifest, defaultGroups);
  assert.ok(small.reduce((sum, fixture) => sum + fixture.bytes, 0) < 10 * 1048576);
});

test("all selects every remote fixture and unknown groups fail", () => {
  assert.equal(selectFixtures(manifest, ["all"]).length, manifest.remote.length);
  assert.throws(() => selectFixtures(manifest, ["smal"]), /unknown fixture group smal/);
});

test("the manifest rejects bad checksums and duplicate files", () => {
  const entry = {
    file: "a.svs",
    url: "https://example.org/a.svs",
    sha256: "0".repeat(64),
    bytes: 1,
    groups: ["small"],
  };
  assert.doesNotThrow(() => parseManifest(JSON.stringify({ remote: [entry], synthetic: [] })));
  assert.throws(
    () => parseManifest(JSON.stringify({ remote: [{ ...entry, sha256: "abc" }], synthetic: [] })),
    /invalid remote fixture/,
  );
  assert.throws(
    () => parseManifest(JSON.stringify({ remote: [entry, entry], synthetic: [] })),
    /a.svs is listed twice/,
  );
});

test("committed synthetic slides match their checksums", async () => {
  assert.ok(manifest.synthetic.length > 0);
  for (const fixture of manifest.synthetic) {
    assert.equal(await sha256Of(syntheticPath(fixture.file)), fixture.sha256, fixture.file);
  }
});

test("synthetic slides are TIFF files", async () => {
  for (const fixture of manifest.synthetic) {
    const header = (await readFile(join(syntheticDir, fixture.file))).subarray(0, 4);
    assert.deepEqual([...header], [0x49, 0x49, 0x2a, 0x00], fixture.file);
  }
});

test("the cache directory honours overrides", () => {
  assert.equal(fixturesDir({ PARFOCAL_FIXTURES_DIR: "/data/fixtures" }), "/data/fixtures");
  assert.equal(fixturesDir({ XDG_CACHE_HOME: "/xdg" }), "/xdg/parfocal/fixtures");
});

test("local fixture folders come from a path list", () => {
  assert.deepEqual(localFixtureDirs({ PARFOCAL_FIXTURES_LOCAL: "/poc/formats::/poc/other" }), [
    "/poc/formats",
    "/poc/other",
  ]);
  assert.deepEqual(localFixtureDirs({}), []);
});
