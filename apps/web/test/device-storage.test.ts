import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url).pathname;
const policy = readFileSync(join(root, "docs/compliance/cookies-and-storage.md"), "utf8");

function sources(directory: string, pattern: RegExp): string[] {
  return readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
    .filter((path) => pattern.test(path))
    .map((path) => readFileSync(join(root, directory, path), "utf8"));
}

function storageKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(/Item\(\s*"([^"]+)"/g)) keys.add(match[1] ?? "");
  for (const match of source.matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) {
    const [, name, value] = match;
    if (
      name !== undefined &&
      value !== undefined &&
      new RegExp(`Item\\(\\s*${name}\\b`).test(source)
    ) {
      keys.add(value);
    }
  }
  return [...keys];
}

const webSources = sources("apps/web/src", /\.tsx?$/);
const apiSources = sources("apps/api/src", /\.py$/);

test("storage keys are found in getItem calls and in constants they use", () => {
  const source =
    'const key = "a.b";\nconst other = "c";\nstorage.getItem(key);\nstorage.setItem("d", "1");';
  assert.deepEqual(storageKeys(source).sort(), ["a.b", "d"]);
});

test("every browser storage key of the web app is in the cookie and storage policy", () => {
  const keys = webSources.flatMap(storageKeys);
  assert.ok(keys.includes("parfocal-theme") && keys.includes("parfocal.uploads.interrupted"));
  for (const key of keys)
    assert.ok(policy.includes(`\`${key}\``), `${key} is missing from cookies-and-storage.md`);
});

test("the web app never writes a cookie itself", () => {
  for (const source of webSources) assert.doesNotMatch(source, /document\.cookie/);
});

test("every cookie the API sets is in the cookie and storage policy", () => {
  const cookies = apiSources.flatMap((source) =>
    [...source.matchAll(/"(__Host-[\w-]+)"/g)].map((match) => match[1]),
  );
  assert.ok(cookies.length >= 2);
  for (const cookie of cookies)
    assert.ok(policy.includes(`\`${cookie}\``), `${cookie} is missing from cookies-and-storage.md`);
});
