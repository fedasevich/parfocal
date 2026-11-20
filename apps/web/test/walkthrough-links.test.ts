import assert from "node:assert/strict";
import { test } from "node:test";
import type { Target } from "@parfocal/api-client";
import { targetHref } from "../src/shell/notification-target.ts";
import { pageTitleOf, routeTitleOf } from "../src/shell/page-title-parts.ts";
import { reloadForStaleChunk } from "../src/shell/stale-chunks.ts";
import { initialsOf } from "../src/shell/workspace-initials.ts";
import { cellSampleOf, correctedMode, viewerModeOf } from "../src/viewer/viewer-mode.ts";

const origin = { route: "home" as const };
const target = (fields: Partial<Target> & Pick<Target, "kind">): Target => ({
  project_id: "p1",
  origin,
  ...fields,
});

test("a notification target turns into the address of its screen", () => {
  assert.equal(
    targetHref(target({ kind: "slide", slide_id: "s1", task_id: "t1", object_id: "T4" })),
    "/projects/p1/slides/s1?task=t1&object=T4",
  );
  assert.equal(
    targetHref(target({ kind: "decision", slide_id: "s1", task_id: "t1" })),
    "/projects/p1/slides/s1?task=t1",
  );
  assert.equal(
    targetHref(target({ kind: "thread", slide_id: "s1", object_id: "T2" })),
    "/projects/p1/slides/s1?object=T2&tab=comments",
  );
  assert.equal(targetHref(target({ kind: "task", task_id: "t1" })), "/tasks/t1/guided");
  assert.equal(targetHref(target({ kind: "evaluation", task_id: "t1" })), "/tasks/t1/evaluation");
  assert.equal(targetHref(target({ kind: "job", job_id: "j1" })), "/projects/p1/jobs/j1");
  assert.equal(targetHref(target({ kind: "project" })), "/projects/p1");
  assert.equal(targetHref(target({ kind: "delivery" })), "/admin?section=api");
  assert.equal(targetHref(target({ kind: "source", project_id: null })), "/admin?section=storage");
});

test("a notification target with a missing part has no address", () => {
  assert.equal(targetHref(target({ kind: "slide", project_id: null, slide_id: "s1" })), null);
  assert.equal(targetHref(target({ kind: "task" })), null);
  assert.equal(targetHref(target({ kind: "evaluation" })), null);
  assert.equal(targetHref(target({ kind: "job" })), null);
  assert.equal(targetHref(target({ kind: "project", project_id: null })), null);
  assert.equal(targetHref(target({ kind: "access-request" })), null);
});

const edit = { kind: "edit" } as const;
const notAssigned = { kind: "read-only", reason: "not-assigned" } as const;

test("an annotate task always opens in annotate and the address is corrected", () => {
  const rule = viewerModeOf({
    hasTask: true,
    taskKind: "annotate",
    access: edit,
    chosen: "guided",
  });
  assert.equal(rule.mode, "annotate");
  assert.equal(correctedMode("guided", rule, true), "annotate");
  assert.equal(correctedMode("guided", rule, false), undefined);
  assert.equal(correctedMode(undefined, rule, true), undefined);
  assert.equal(correctedMode("annotate", rule, true), undefined);
});

test("cells on a task with no cell sample falls back to review", () => {
  const facts = { hasTask: true, taskKind: "review", access: edit, chosen: "cells" } as const;
  assert.equal(viewerModeOf({ ...facts, cellSample: false }).mode, "review");
  assert.equal(viewerModeOf({ ...facts, cellSample: true }).mode, "cells");
  assert.equal(viewerModeOf(facts).mode, "cells");
  assert.equal(viewerModeOf({ ...facts, access: notAssigned, cellSample: false }).mode, "review");
  assert.equal(viewerModeOf({ ...facts, cellSample: false }).noCellSample, true);
  assert.equal(viewerModeOf({ ...facts, cellSample: true }).noCellSample, false);
});

test("cells opens read only for a person not assigned when the slide has a cell sample", () => {
  const facts = {
    hasTask: true,
    taskKind: "review",
    access: notAssigned,
    chosen: "cells",
  } as const;
  const rule = viewerModeOf({ ...facts, cellSample: true });
  assert.equal(rule.mode, "cells");
  assert.deepEqual(rule.choices, []);
  assert.equal(viewerModeOf({ ...facts, chosen: "annotate", cellSample: true }).mode, "review");
  assert.equal(
    viewerModeOf({ ...facts, taskKind: "annotate", cellSample: true }).noCellSample,
    false,
  );
  assert.equal(cellSampleOf(undefined), undefined);
  assert.equal(cellSampleOf({ objects: [{ kind: "region" }] }), false);
  assert.equal(cellSampleOf({ objects: [{ kind: "region" }, { kind: "cell" }] }), true);
});

test("the tab title names the page and the slide", () => {
  const titles = { "/": "Home", "/projects/$projectId/slides/$slideId": "Slide" };
  assert.equal(routeTitleOf(["__root__", "/projects/$projectId/slides/$slideId"], titles), "Slide");
  assert.equal(routeTitleOf(["__root__"], titles), undefined);
  assert.equal(pageTitleOf(["S26-04812 A1", "Slide"]), "S26-04812 A1 · Slide · Parfocal");
  assert.equal(pageTitleOf([null, undefined]), "Parfocal");
});

test("a stale chunk reloads the page once a minute at most", () => {
  const stored = new Map<string, string>();
  let reloads = 0;
  let clock = 100_000;
  const place = {
    storage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    },
    now: () => clock,
    reload: () => {
      reloads += 1;
    },
  };
  assert.equal(reloadForStaleChunk(place), true);
  assert.equal(reloadForStaleChunk(place), false);
  clock += 61_000;
  assert.equal(reloadForStaleChunk(place), true);
  assert.equal(reloads, 2);
});

test("workspaces of one organisation get initials from their own name", () => {
  assert.equal(initialsOf("ČVUT · Medical Imaging Group"), "MI");
  assert.equal(initialsOf("ČVUT · Machine Learning Lab"), "ML");
  assert.equal(initialsOf("Brno Pathology"), "BP");
});
