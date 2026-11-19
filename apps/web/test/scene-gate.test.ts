import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import type { z } from "zod";
import * as routeSearches from "../src/search/route-searches.ts";
import { type SceneFieldMeta, sceneField, sceneHarnessOn } from "../src/search/scene-harness.ts";
import { overlaySearch } from "../src/shell/overlays.ts";
import { developerRouteFiles } from "../vite/dev-tools.ts";

const src = new URL("../src/", import.meta.url).pathname;
const routesDir = join(src, "routes");

const developerRoutes = [
  "flow-map.index.tsx",
  "flow-map.walkthrough.$chapter.tsx",
  "flow-map.walkthrough.index.tsx",
  "issue-pages.$kind.tsx",
  "issue-states.tsx",
  "kpi.tsx",
  "prototype.tsx",
  "spikes.hotkeys.tsx",
  "spikes.input-traces.tsx",
  "spikes.worklist.tsx",
];

const productRoutes: Record<string, readonly string[]> = {
  "__root.tsx": [],
  "admin.tsx": ["tplnew", "tpledit", "addmodel", "addtested", "addfail", "addmap"],
  "developer.tsx": [],
  "index.tsx": [],
  "invitations.$token.tsx": [],
  "invite.tsx": ["landing", "account"],
  "my-work.tsx": [],
  "notifications.tsx": [],
  "popout.tsx": ["objects", "travel", "picked", "picking"],
  "projects.$projectId.cases.$caseId.co-sign.tsx": [],
  "projects.$projectId.cases.$caseId.report.tsx": [],
  "projects.$projectId.cases.$caseId.upload.tsx": [],
  "projects.$projectId.cases.new.tsx": [],
  "projects.$projectId.index.tsx": [],
  "projects.$projectId.jobs.$jobId.tsx": [],
  "projects.$projectId.run-model.tsx": [],
  "projects.$projectId.slides.$slideId.tsx": ["objects", "travel", "picked", "picking"],
  "projects.$projectId.slides.$slideId_.annotate-task.tsx": [],
  "projects.$projectId.slides.$slideId_.annotate.tsx": ["auto", "models"],
  "projects.$projectId.slides.$slideId_.live.tsx": [],
  "projects.$projectId.tasks.new-annotate.tsx": [],
  "projects.$projectId.tasks.new.tsx": [],
  "projects.$projectId.upload.tsx": ["empty", "files", "check", "progress", "done"],
  "projects.new.tsx": [],
  "search.tsx": [],
  "settings.$section.tsx": [],
  "settings.index.tsx": [],
  "setup.tsx": [],
  "shared-reports.$token.tsx": [],
  "sign-in.tsx": ["email", "sso", "forgot", "reset", "passkey", "passkeyqr", "lock", "lockkey"],
  "sign-up.tsx": ["form", "verify"],
  "study.tsx": [],
  "tasks.$taskId.adjudicate.tsx": [],
  "tasks.$taskId.cells.tsx": [],
  "tasks.$taskId.comments.tsx": [],
  "tasks.$taskId.disagreements.tsx": [],
  "tasks.$taskId.evaluation.tsx": ["report", "arrange", "pdf"],
  "tasks.$taskId.guided.tsx": ["region"],
  "tasks.$taskId.sign-off.tsx": [],
  "tasks.$taskId.submitted.tsx": [],
  "team.tsx": ["nudge", "reassign", "signoff"],
};

const devToolsOnly = [
  /^fake-api\//,
  /^flow-map\//,
  /prototype-scenes\.ts$/,
  /\.stories\.tsx?$/,
  /^search\/scene-harness\.ts$/,
];

const ungatedSceneRead = [
  /\bscene:\s*z\./,
  /\.get\(\s*["']scene["']\s*\)/,
  /\b[a-z]\w*\??\.?\[\s*["']scene["']\s*\]/,
  /\bscene\s*=\s*[^=]*\b(location|searchParams|URLSearchParams)\b/,
];

type Searches = Record<string, { shape?: Record<string, z.ZodType> }>;
const searches: Searches = { ...routeSearches, overlaySearch };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function routeFile(name: string): string {
  return readFileSync(join(routesDir, name), "utf8");
}

function searchOf(name: string): string | undefined {
  return /validateSearch:\s*(\w+)/.exec(routeFile(name))?.[1];
}

function sceneMeta(searchName: string): SceneFieldMeta | undefined {
  const field = searches[searchName]?.shape?.["scene"];
  if (field === undefined) return undefined;
  const meta = field.meta() as Partial<SceneFieldMeta> | undefined;
  assert.ok(meta?.scenes && meta.live, `${searchName} reads a scene without the gated scene field`);
  return { scenes: meta.scenes, live: meta.live };
}

test("every route file is either a product route or a developer route", () => {
  const files = readdirSync(routesDir).filter((name) => name.endsWith(".tsx"));
  assert.deepEqual(files.sort(), [...developerRoutes, ...Object.keys(productRoutes)].sort());
});

test("developer routes are left out of the deployed route tree and refuse without dev tools", () => {
  const pattern = new RegExp(developerRouteFiles);
  for (const name of developerRoutes) {
    assert.ok(pattern.test(name), `${name} would ship in the deployed route tree`);
    assert.match(
      routeFile(name),
      /PARFOCAL_PUBLIC_DEV_TOOLS !== "on"\) throw notFound\(\)/,
      `${name} has no dev tools gate`,
    );
  }
  for (const name of Object.keys(productRoutes)) {
    assert.ok(!pattern.test(name), `${name} is a product route caught by the developer pattern`);
  }
});

test("each product route keeps only its listed scenes when dev tools are off", () => {
  for (const [name, kept] of Object.entries(productRoutes)) {
    const searchName = searchOf(name);
    const meta = searchName === undefined ? undefined : sceneMeta(searchName);
    assert.deepEqual([...(meta?.live ?? [])].sort(), [...kept].sort(), name);
    if (meta === undefined) continue;
    const deployed = sceneField(meta.scenes as [string, ...string[]], meta.live, false);
    const reached = meta.scenes.filter((scene) => deployed.parse(scene) !== undefined);
    assert.deepEqual(reached.sort(), [...kept].sort(), name);
  }
});

test("no product source reads a scene outside the dev tools gate", () => {
  const developerRoute = new RegExp(`^routes/${developerRouteFiles.slice(1)}`);
  const offenders = sourceFiles(src)
    .map((file) => relative(src, file))
    .filter((name) => !devToolsOnly.some((pattern) => pattern.test(name)))
    .filter((name) => !developerRoute.test(name))
    .filter((name) => {
      const text = readFileSync(join(src, name), "utf8");
      return ungatedSceneRead.some((pattern) => pattern.test(text));
    });
  assert.deepEqual(offenders, []);
});

test("scenes run only with dev tools and the fake API both on", () => {
  assert.equal(sceneHarnessOn({}), false);
  assert.equal(sceneHarnessOn({ PARFOCAL_PUBLIC_FAKE_API: "all" }), false);
  assert.equal(
    sceneHarnessOn({ PARFOCAL_PUBLIC_DEV_TOOLS: "off", PARFOCAL_PUBLIC_FAKE_API: "all" }),
    false,
  );
  assert.equal(
    sceneHarnessOn({ PARFOCAL_PUBLIC_DEV_TOOLS: "on", PARFOCAL_PUBLIC_FAKE_API: "off" }),
    false,
  );
  assert.equal(sceneHarnessOn({ PARFOCAL_PUBLIC_DEV_TOOLS: "on" }), false);
  assert.equal(
    sceneHarnessOn({ PARFOCAL_PUBLIC_DEV_TOOLS: "on", PARFOCAL_PUBLIC_FAKE_API: "all" }),
    true,
  );
  assert.equal(
    sceneHarnessOn({ PARFOCAL_PUBLIC_DEV_TOOLS: "on", PARFOCAL_PUBLIC_FAKE_API: "drafts" }),
    true,
  );
});

test("a gated scene field drops prototype scenes and keeps live ones", () => {
  const field = sceneField(["files", "allgood", "storagefull"], ["files"], false);
  assert.equal(field.parse("files"), "files");
  assert.equal(field.parse("allgood"), undefined);
  assert.equal(field.parse(undefined), undefined);
  const harness = sceneField(["files", "allgood"], ["files"], true);
  assert.equal(harness.parse("allgood"), "allgood");
});
