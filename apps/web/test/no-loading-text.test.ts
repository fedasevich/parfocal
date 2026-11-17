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

test("the screens that waited now use the Loader or a skeleton part", () => {
  const files = [
    "screens/home/home-screen.tsx",
    "screens/team/team-screen.tsx",
    "viewer/stage-opening.tsx",
    "session/boot-loader.tsx",
    "screens/placeholder.tsx",
    "screens/project/tasks-tab.tsx",
    "screens/search/search-screen.tsx",
    "screens/admin/admin-screen.tsx",
    "screens/admin/overview.tsx",
    "screens/admin/storage.tsx",
    "screens/admin/retention.tsx",
    "screens/admin/sections.tsx",
    "screens/admin/join-settings.tsx",
    "screens/admin/workspace-settings.tsx",
    "screens/upload/upload-page.tsx",
    "screens/upload/live-page.tsx",
    "screens/shared-report/shared-report-screen.tsx",
  ];
  for (const file of files) {
    assert.match(
      readFileSync(join(root, file), "utf8"),
      /<Loader\b|<SkeletonRows\b|<SkeletonCards\b|<SkeletonPanel\b/,
      file,
    );
  }
});

test("a whole page load shows the reticle loader full screen", () => {
  assert.match(readFileSync(join(root, "session/boot-loader.tsx"), "utf8"), /size="page"/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5/);
  assert.doesNotMatch(html, /boot-loader-bar/);
});
