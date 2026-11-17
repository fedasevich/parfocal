import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { sceneField, sceneHarnessOn } from "../src/search/scene-harness.ts";

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

const STILL_TO_REPLACE = new Set([
  "screens/annotate-task/annotate-task-view.tsx",
  "screens/annotate-task/task-people.ts",
  "screens/annotate-task/task-shapes.tsx",
  "screens/review/cells-grid.tsx",
  "screens/review/comments-on-ids.tsx",
  "screens/review/guided-review.tsx",
  "screens/review/review-top-popovers.tsx",
  "screens/review/review-top.tsx",
  "screens/review/slide-still.tsx",
  "screens/review/slide-submitted.tsx",
  "screens/thumbnails.ts",
  "screens/viewer-tools/annotate-view.tsx",
  "screens/viewer-tools/cell-focus.tsx",
  "screens/viewer-tools/compare-view.tsx",
  "screens/viewer-tools/focus-view.tsx",
  "screens/viewer-tools/navigator-canvas.tsx",
  "screens/viewer-tools/slide-peek.tsx",
  "screens/viewer-tools/viewer-minimap.tsx",
  "screens/viewer/layer-views.tsx",
  "screens/viewer/use-viewer-panels.tsx",
  "screens/viewer/viewer-canvas-parts.tsx",
]);

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

const ungatedScene = [/\bscene:\s*z\./, /\.get\(\s*["']scene["']\s*\)/];

function ungatedSceneReaders(): string[] {
  return sourceFiles(root)
    .map((file) => relative(root, file))
    .filter((name) => !outsideProduction.some((pattern) => pattern.test(name)))
    .filter((name) => name !== "search/scene-harness.ts")
    .filter((name) => {
      const text = readFileSync(join(root, name), "utf8");
      return ungatedScene.some((pattern) => pattern.test(text));
    });
}

test("a production route reads a scene only through the gated scene field", () => {
  assert.deepEqual(ungatedSceneReaders(), []);
});

test("the deployed build keeps only the scenes a real control writes", () => {
  const field = sceneField(["files", "allgood", "storagefull"], ["files"], false);
  assert.equal(field.parse("files"), "files");
  assert.equal(field.parse("allgood"), undefined);
  assert.equal(field.parse(undefined), undefined);
  const harness = sceneField(["files", "allgood"], ["files"], true);
  assert.equal(harness.parse("allgood"), "allgood");
});

test("scenes run only in a fake API build", () => {
  assert.equal(sceneHarnessOn({ PARFOCAL_PUBLIC_FAKE_API: "off" }), false);
  assert.equal(sceneHarnessOn({}), false);
  assert.equal(sceneHarnessOn({ PARFOCAL_PUBLIC_FAKE_API: "" }), false);
  assert.equal(sceneHarnessOn({ PARFOCAL_PUBLIC_FAKE_API: "all" }), true);
  assert.equal(sceneHarnessOn({ PARFOCAL_PUBLIC_FAKE_API: "drafts" }), true);
});

test("a screen that no longer uses the prototype leaves the list", () => {
  const found = offenders();
  const done = [...STILL_TO_REPLACE].filter((name) => !found.has(name));
  assert.deepEqual(done, []);
});
