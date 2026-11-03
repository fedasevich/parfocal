import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectorCounts, templateName } from "../src/lib/inspector-tabs.ts";

const sources = {
  objects: 5,
  resultSets: 3,
  threads: [{ resolved: false }, { resolved: true }, { resolved: false }],
  questions: [{ answered: true }, { answered: false }],
};

test("each tab counts its own things: objects, result sets, open threads and unanswered questions", () => {
  assert.deepEqual(inspectorCounts(sources), {
    objects: 5,
    display: 3,
    comments: 2,
    opinion: 1,
  });
});

test("counts follow a resolved thread, an answered question and a removed result set", () => {
  const next = inspectorCounts({
    ...sources,
    resultSets: 2,
    threads: sources.threads.map((thread) => ({ ...thread, resolved: true })),
    questions: sources.questions.map((question) => ({ ...question, answered: true })),
  });
  assert.deepEqual(next, { objects: 5, display: 2, comments: 0, opinion: 0 });
});

test("each template has a plain name and none says so", () => {
  assert.equal(templateName("sentinel-node"), "Sentinel node staging");
  assert.equal(templateName("cell-review"), "Cell review");
  assert.equal(templateName("none"), "No analysis template");
});
