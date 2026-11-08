import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  cachedFixture,
  cacheKey,
  loadManifest,
  parseManifest,
  requiredGroups,
  skipUnlessCached,
} from "../src/index.ts";

const empty = await mkdtemp(join(tmpdir(), "parfocal-fixtures-"));
after(() => rm(empty, { recursive: true, force: true }));

test("a missing fixture outside the required groups is skipped with the fetch command", () => {
  const env = { PARFOCAL_FIXTURES_DIR: empty, PARFOCAL_REQUIRE_FIXTURES: "small" };
  assert.equal(cachedFixture("tumor_009.tif", env), null);
  assert.equal(
    skipUnlessCached("tumor_009.tif", env),
    "tumor_009.tif is not downloaded, run: pnpm fixtures camelyon",
  );
});

test("a missing fixture in a required group fails instead of skipping", () => {
  const env = { PARFOCAL_FIXTURES_DIR: empty, PARFOCAL_REQUIRE_FIXTURES: "small, formats" };
  assert.throws(() => cachedFixture("CMU-1.svs", env), /CMU-1.svs is not downloaded.*REQUIRE/);
  assert.throws(() => skipUnlessCached("CMU-1-Small-Region.svs", env), /not downloaded/);
});

test("a verified fixture resolves to its cache path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "parfocal-fixtures-"));
  await writeFile(join(dir, "CMU-1.svs"), "");
  await writeFile(join(dir, "CMU-1.svs.sha256"), "");
  const env = { PARFOCAL_FIXTURES_DIR: dir, PARFOCAL_REQUIRE_FIXTURES: "formats" };
  assert.equal(cachedFixture("CMU-1.svs", env), join(dir, "CMU-1.svs"));
  assert.equal(skipUnlessCached("CMU-1.svs", env), false);
  await rm(dir, { recursive: true, force: true });
});

test("a file outside the manifest is an error", () => {
  assert.throws(
    () => cachedFixture("nope.svs", { PARFOCAL_FIXTURES_DIR: empty }),
    /not in fixtures.json/,
  );
});

test("required groups are read from a comma list", () => {
  assert.deepEqual(
    [...requiredGroups({ PARFOCAL_REQUIRE_FIXTURES: " small,,viewer " })],
    ["small", "viewer"],
  );
  assert.equal(requiredGroups({}).size, 0);
});

test("the cache key follows the checksums of the chosen groups only", () => {
  const entry = (file: string, sha: string, group: string) => ({
    file,
    url: `https://example.org/${file}`,
    sha256: sha.repeat(64),
    bytes: 1,
    groups: [group],
  });
  const manifest = (formatsSha: string) =>
    parseManifest(
      JSON.stringify({
        remote: [entry("a.svs", "0", "small"), entry("b.svs", formatsSha, "formats")],
        synthetic: [],
      }),
    );
  assert.equal(cacheKey(manifest("1"), ["small"]), cacheKey(manifest("2"), ["small"]));
  assert.notEqual(cacheKey(manifest("1"), ["formats"]), cacheKey(manifest("2"), ["formats"]));
  assert.equal(
    cacheKey(manifest("1"), ["small", "formats"]),
    cacheKey(manifest("1"), ["formats", "small"]),
  );
  assert.match(cacheKey(loadManifest(), ["small"]), /^[0-9a-f]{64}$/);
});
