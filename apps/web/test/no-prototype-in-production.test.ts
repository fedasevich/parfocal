import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url).pathname;

const outsideProduction = [
  /^fake-api\//,
  /^flow-map\//,
  /prototype-scenes\.ts$/,
  /^routes\/prototype\.tsx$/,
  /\.stories\.tsx?$/,
];

const prototypeUse = [
  /@parfocal\/api-client\/fake/,
  /\blookUrl\(/,
  /\bcoverTile\(/,
  /mock-assets/,
  /fake-task\.ts/,
  /mock-toast/,
  /imported 12 Oct/,
  /Signed off 15 Oct/,
];

const STILL_TO_REPLACE = new Set<string>();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function offenders(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(root)) {
    const name = relative(root, file);
    if (outsideProduction.some((pattern) => pattern.test(name))) continue;
    const text = readFileSync(file, "utf8");
    if (prototypeUse.some((pattern) => pattern.test(text))) found.add(name);
  }
  return found;
}

test("no production screen gains prototype pictures, fake data or mock dates", () => {
  const added = [...offenders()].filter((name) => !STILL_TO_REPLACE.has(name));
  assert.deepEqual(added, []);
});

test("a screen that no longer uses the prototype leaves the list", () => {
  const found = offenders();
  const done = [...STILL_TO_REPLACE].filter((name) => !found.has(name));
  assert.deepEqual(done, []);
});
