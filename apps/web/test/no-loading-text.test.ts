import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const allowedLine = /label=|TileHint/;

const stageLabel = "viewer/stage-opening.tsx";

test("no screen waits with loading text outside a Loader label", () => {
  const found: string[] = [];
  for (const file of sourceFiles(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (/Loading\b/.test(line) && !allowedLine.test(line) && !file.endsWith(stageLabel)) {
          found.push(`${file.slice(root.length)}:${index + 1} ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(found, []);
});

test("the screens that waited now use the Loader or skeleton rows", () => {
  const files = [
    "screens/home/home-screen.tsx",
    "screens/team/team-screen.tsx",
    "viewer/stage-opening.tsx",
  ];
  for (const file of files) {
    assert.match(readFileSync(join(root, file), "utf8"), /<Loader\b|<SkeletonRows\b/);
  }
});
