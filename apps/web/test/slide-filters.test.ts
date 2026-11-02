import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlideRow } from "@parfocal/api-client";
import {
  activeFilterCount,
  filterChoices,
  type SlideFilterValues,
  slideQuery,
  statusChoices,
  withFilter,
} from "../src/screens/my-work/slide-filters.ts";

const none: SlideFilterValues = {
  project: undefined,
  status: undefined,
  set: undefined,
  reviewer: undefined,
};

const row = (id: string, project: string, setNames: string[], reviewers: string[]): SlideRow => ({
  id,
  label: id,
  project: { id: project, code: project.toUpperCase(), name: `Project ${project}` },
  case_id: null,
  case_label: null,
  result_sets: setNames.map((name) => ({ id: name, name, status: "ready" })),
  reviews: reviewers.map((user) => ({
    task_id: "t1",
    task_code: "RT-1",
    user_id: user,
    state: "in-review",
  })),
  status: "ready",
  created_at: "2026-10-12T09:00:00+02:00",
});

test("no filters and no search send no query at all", () => {
  assert.equal(slideQuery(none, ""), undefined);
});

test("each filter maps to its API parameter and they combine with the search", () => {
  assert.deepEqual(slideQuery({ ...none, project: "p7" }, ""), { project_id: "p7" });
  assert.deepEqual(slideQuery({ ...none, status: "in-review" }, ""), { status: "in-review" });
  assert.deepEqual(slideQuery({ ...none, set: "Nuclei 2.1" }, ""), { result_set: "Nuclei 2.1" });
  assert.deepEqual(slideQuery({ ...none, reviewer: "u2" }, ""), { reviewer_id: "u2" });
  assert.deepEqual(
    slideQuery({ project: "p7", status: "submitted", set: "Nuclei 2.1", reviewer: "u2" }, "tum"),
    {
      q: "tum",
      project_id: "p7",
      status: "submitted",
      result_set: "Nuclei 2.1",
      reviewer_id: "u2",
    },
  );
});

test("changing one filter keeps the others, and undefined clears it", () => {
  const two = withFilter(withFilter(none, "project", "p7"), "status", "ready");
  assert.equal(activeFilterCount(two), 2);
  const cleared = withFilter(two, "project", undefined);
  assert.deepEqual(cleared, { ...none, status: "ready" });
  assert.equal(activeFilterCount(cleared), 1);
  assert.equal(activeFilterCount(none), 0);
});

test("the choices list each project, result set and reviewer once, sorted", () => {
  const rows = [
    row("s1", "p9", ["Nuclei 2.1", "Tumour 1.0"], ["u2", "u1"]),
    row("s2", "p7", ["Nuclei 2.1"], ["u1"]),
    row("s3", "p7", [], []),
  ];
  const names: Record<string, string> = { u1: "Zdenek", u2: "Anna" };
  const choices = filterChoices(rows, (userId) => names[userId] ?? userId);
  assert.deepEqual(
    choices.projects.map((choice) => choice.hint),
    ["P7", "P9"],
  );
  assert.deepEqual(
    choices.sets.map((choice) => choice.value),
    ["Nuclei 2.1", "Tumour 1.0"],
  );
  assert.deepEqual(
    choices.reviewers.map((choice) => choice.label),
    ["Anna", "Zdenek"],
  );
});

test("the status choices cover every state a slide can be in", () => {
  assert.equal(new Set(statusChoices.map((choice) => choice.value)).size, statusChoices.length);
  assert.ok(statusChoices.some((choice) => choice.value === "disagreement-queue"));
});
