import assert from "node:assert/strict";
import { test } from "node:test";
import { checkChangeOf, checkPresetOf } from "../src/screens/new-task/annotate-draft.ts";
import {
  annotateSlideLine,
  applyTemplate,
  blockersFor,
  displaySummary,
  estimateText,
  initialDraft,
  issues,
  mappingOk,
  mappingText,
  type Preset,
  sceneDraft,
  scopePhrase,
  sendLabel,
  slideLine,
  slidesWithResult,
  stepKeys,
  stepState,
  summary,
  type TaskData,
  taskScenes,
  templateChanges,
} from "../src/screens/new-task/model.ts";

const display: Preset["display"] = {
  draw: "outline",
  width: 2,
  opacity: 100,
  colorBy: "class",
  ids: true,
  conf: "number",
  heat: 0,
  cutoff: 0.4,
  sets: { cam: true, sam: false, rev: true },
  order: "ai",
  zoom: "fit",
  auto: true,
  buttons: "right",
};

const preset = (more: Partial<Preset> = {}): Preset => ({
  scope: ["regions", "cells"],
  scopeOptions: { cells: 50, low: 0.6, roi: ["R1", "R2", "R3", "R4"], unsure: ["Z1", "Z2", "Z3"] },
  decision: { kind: "certainty5", agreeFrom: 4, disagreeTo: 2 },
  display,
  form: "default",
  blind: true,
  hide: false,
  start: "guided",
  split: "all",
  ...more,
});

const slide = (id: string, caseLabel: string | null, sets: string[]) => ({
  id,
  name: id,
  caseLabel,
  sets,
});

const data: TaskData = {
  code: "RT-16",
  taskId: "rt16",
  projectId: "p07",
  projectName: "Sentinel node AI evaluation",
  today: "2026-10-15",
  slides: [
    slide("a1", "S26-04812", ["cam", "sam"]),
    slide("a2", "S26-04812", ["cam", "sam"]),
    slide("a3", "S26-04812", ["cam", "sam"]),
    ...["b1", "b2", "b3"].map((id) => slide(id, "S26-04769", ["cam", "sam"])),
    ...["b4", "b5", "b6"].map((id) => slide(id, "S26-04769", ["cam"])),
    ...["t102", "t105", "t110"].map((id) => slide(id, null, ["sam"])),
    slide("t088", null, ["cam"]),
  ],
  groups: [
    { key: "S26-04812", title: "Case S26-04812", sub: "", slideIds: ["a1", "a2", "a3"] },
    {
      key: "S26-04769",
      title: "Case S26-04769",
      sub: "",
      slideIds: ["b1", "b2", "b3", "b4", "b5", "b6"],
    },
    { key: "loose", title: "Loose slides", sub: "", slideIds: ["t102", "t105", "t110"] },
  ],
  pool: ["t088"],
  resultSets: [
    {
      id: "cam",
      key: "cam",
      label: "CAMELYON tumor model v1.0",
      short: "CAMELYON v1.0",
      detail: "",
    },
    {
      id: "sam",
      key: "sam",
      label: "PathoSAM + HoVer-NeXt v1.2",
      short: "PathoSAM v1.2",
      detail: "",
    },
  ],
  names: { cam: "Round 3 · CAMELYON v1.0", sam: "Round 1 · PathoSAM v1.2" },
  templates: [
    {
      id: "sn",
      name: "Sentinel node AI evaluation",
      version: "v3",
      kind: "",
      retired: false,
      preset: preset(),
    },
    {
      id: "cell",
      name: "Cell typing study",
      version: "v2",
      kind: "",
      retired: false,
      preset: preset({
        scope: ["cells", "low"],
        decision: { kind: "blind", agreeFrom: 4, disagreeTo: 2 },
        display: { ...display, draw: "dots", ids: false },
      }),
    },
  ],
  defaultTemplateId: "sn",
  people: ["LM", "SM", "AK", "JR", "TB", "PK"].map((initials) => ({
    id: initials,
    name: initials,
    initials,
    colour: "#000",
    title: "",
    openTasks: 0,
    awayUntil: initials === "PK" ? "22 Oct" : null,
  })),
  rois: [],
  zones: [
    { key: "Z1", cells: 14 },
    { key: "Z2", cells: 12 },
    { key: "Z3", cells: 10 },
  ],
  forms: [
    {
      key: "default",
      name: "Default opinion form",
      questions: [
        { label: "q1", kind: "scale", required: true },
        { label: "q2", kind: "choice", required: false },
        { label: "q3", kind: "yesno", required: true },
      ],
    },
  ],
  defaults: {
    resultSetId: "cam",
    reviewerIds: ["LM", "SM"],
    due: "2026-10-30",
    reminders: "2d-daily",
  },
};

test("the default draft picks 12 slides, 9 with CAMELYON, for two reviewers", () => {
  const draft = sceneDraft(data, "slides");
  const sum = summary(draft, data);
  assert.equal(sum.all, 12);
  assert.equal(sum.ns, 9);
  assert.equal(slideLine(sum, "CAMELYON v1.0"), "12 picked. 9 have CAMELYON v1.0, 3 are left out.");
  assert.equal(draft.name, "Round 3 · CAMELYON v1.0");
  assert.deepEqual(draft.required, ["q1", "q3"]);
  assert.deepEqual(issues(draft, data), []);
  assert.equal(sendLabel(draft), "Create and notify 2 reviewers");
});

test("the estimate counts 55 objects per slide and 3 hours each", () => {
  const draft = sceneDraft(data, "check");
  assert.equal(
    estimateText(draft, data),
    "About 55 objects per slide and 3 hours for each reviewer. Every object keeps its ID, so each decision traces back to one region or cell.",
  );
  assert.equal(scopePhrase(draft), "Tumor regions and 50 random cells per slide");
});

test("the decision scene moves agree to 5 and leaves 3 and 4 not sure", () => {
  const draft = sceneDraft(data, "decision");
  assert.equal(
    mappingText(draft.decision),
    "5 counts as agree with the AI, 3 and 4 as not sure, and 1 and 2 as disagree.",
  );
  assert.equal(
    mappingText({ kind: "certainty5", agreeFrom: 3, disagreeTo: 2 }),
    "3 to 5 count as agree with the AI, and 1 and 2 as disagree. No answer counts as not sure.",
  );
});

test("each issue scene blocks the step it lives on", () => {
  const expected = {
    noresult: { step: "slides", field: "rset" },
    pastdue: { step: "how", field: "due" },
    retiredtpl: { step: "slides", field: "tpl" },
    nobody: { step: "reviewers", field: "revs" },
  } as const;
  for (const [scene, where] of Object.entries(expected)) {
    const draft = sceneDraft(data, scene as keyof typeof expected);
    const all = issues(draft, data);
    const blockers = blockersFor(all, where.step);
    assert.equal(blockers.length, 1, scene);
    assert.equal(blockers[0]?.field, where.field, scene);
    assert.equal(draft.touched[where.field], true, scene);
  }
});

test("a reviewer who is away is picked without blocking", () => {
  const draft = sceneDraft(data, "away");
  assert.deepEqual(draft.reviewers, ["LM", "SM", "PK"]);
  assert.deepEqual(issues(draft, data), []);
});

test("a lock needs a reason of at least 5 characters", () => {
  const draft = sceneDraft(data, "locks");
  assert.deepEqual(issues(draft, data), []);
  assert.equal(displaySummary(draft), "Outline · confidence as a number · AI order · 1 locked");
  const short = { ...draft, locks: { conf: "Or" } };
  assert.deepEqual(
    issues(short, data).map((issue) => issue.text),
    ["Use at least 5 characters."],
  );
  const empty = { ...draft, locks: { order: " " } };
  assert.equal(issues(empty, data)[0]?.field, "locks.order");
});

test("on Send every open issue is listed, blocking or not", () => {
  const draft = { ...sceneDraft(data, "send"), name: "", due: "2026-10-14" };
  const all = issues(draft, data);
  assert.deepEqual(
    blockersFor(all, "send").map((issue) => issue.field),
    ["name", "due"],
  );
  assert.equal(stepState(draft, all, "slides", "send"), "warn");
  assert.equal(stepState(draft, all, "reviewers", "send"), "done");
});

test("steps not yet seen stay unreachable", () => {
  const draft = sceneDraft(data, "reviewers");
  const all = issues(draft, data);
  assert.equal(stepState(draft, all, "check", "reviewers"), "todo");
  assert.equal(stepState(draft, all, "slides", "reviewers"), "done");
});

test("a template fills scope, decision and display", () => {
  const cell = data.templates[1];
  assert.ok(cell);
  const draft = applyTemplate(sceneDraft(data, "slides"), cell, data);
  assert.equal(draft.decision.kind, "blind");
  assert.equal(draft.display.draw, "dots");
  assert.equal(draft.scope.cells && draft.scope.low && !draft.scope.regions, true);
});

test("each step is filled from either of two templates", () => {
  const [sentinel, cell] = data.templates;
  assert.ok(sentinel && cell);
  const base = sceneDraft(data, "slides");
  const fromSentinel = applyTemplate(base, sentinel, data);
  const fromCell = applyTemplate(fromSentinel, cell, data);
  assert.equal(fromSentinel.templateId, "sn");
  assert.equal(fromCell.templateId, "cell");
  assert.deepEqual(
    [fromSentinel.scope.regions, fromSentinel.decision.kind, fromSentinel.display.draw],
    [true, "certainty5", "outline"],
  );
  assert.deepEqual(
    [fromCell.scope.regions, fromCell.decision.kind, fromCell.display.draw],
    [false, "blind", "dots"],
  );
  assert.deepEqual(templateChanges(fromSentinel, data), {
    check: false,
    how: false,
    form: false,
  });
  assert.deepEqual(templateChanges(fromCell, data), { check: false, how: false, form: false });
});

test("a changed preset is marked and the template stays pinned", () => {
  const sentinel = data.templates[0];
  assert.ok(sentinel);
  const draft = applyTemplate(sceneDraft(data, "slides"), sentinel, data);
  const how = { ...draft, decision: { ...draft.decision, kind: "yesno" as const } };
  assert.deepEqual(templateChanges(how, data), { check: false, how: true, form: false });
  assert.equal(how.templateId, "sn");
  const check = { ...draft, scope: { ...draft.scope, low: true } };
  assert.equal(templateChanges(check, data).check, true);
  const form = { ...draft, form: "none", required: [] };
  assert.equal(templateChanges(form, data).form, true);
  const restored = { ...how, decision: { ...draft.decision } };
  assert.equal(templateChanges(restored, data).how, false);
});

test("every mock scene builds a draft", () => {
  assert.equal(taskScenes.length, 14);
  for (const scene of taskScenes) assert.ok(sceneDraft(data, scene));
});

const annotating = (more: Partial<ReturnType<typeof initialDraft>> = {}) => ({
  ...sceneDraft(data, "slides"),
  kind: "annotate" as const,
  ...more,
});

test("the stepper starts with the kind and a new draft is a review task", () => {
  assert.equal(stepKeys[0], "kind");
  assert.equal(initialDraft(data).kind, "review");
  assert.deepEqual(initialDraft(data).seen, ["kind"]);
});

test("an annotate task keeps slides with no result set and blocks nothing on them", () => {
  const draft = annotating();
  const sum = summary(draft, data);
  assert.equal(sum.ns, 12);
  assert.equal(slidesWithResult(draft, data).length, 9);
  assert.equal(
    annotateSlideLine(sum, 9, "CAMELYON v1.0"),
    "12 picked. 9 have CAMELYON v1.0, 3 have no result set and are annotated by hand.",
  );
  assert.deepEqual(issues(draft, data), []);
  const unmatched = annotating({ resultSetId: "sam", check: { ...draft.check, hasResult: true } });
  assert.deepEqual(issues(unmatched, data), []);
});

test("an annotate task needs no scope or decision mapping", () => {
  const draft = annotating({
    scope: { ...initialDraft(data).scope },
    decision: { kind: "certainty5", agreeFrom: 6, disagreeTo: 2 },
  });
  assert.deepEqual(issues(draft, data), []);
});

test("the annotate estimate follows the preset, the slides and the experts", () => {
  const run = annotating();
  assert.equal(
    estimateText(run, data),
    "About 35 AI objects per slide to check and roughly 3.5 hours for each expert, with 6 minutes of drawing per slide.",
  );
  const hand = annotating({
    preset: "hand",
    check: {
      scope: "none",
      order: "least-sure",
      rule: "warn",
      exportUnchecked: false,
      hasResult: false,
      sampleSize: 200,
    },
  });
  assert.equal(
    estimateText(hand, data),
    "Roughly 1 hour for each expert, with 6 minutes of drawing per slide.",
  );
  const sample = annotating({ check: { ...run.check, scope: "sample" } });
  assert.equal(summary(sample, data).objects, 150);
});

test("the sample estimate and the request use the same size", () => {
  const sample = annotating({
    preset: "sample",
    check: { ...annotating().check, scope: "sample" },
  });
  const preset = { ...sample.check };
  const sent = (check: typeof sample.check) => checkChangeOf(check, preset)?.scope;
  assert.equal(sent(sample.check), undefined);
  const smaller = { ...sample.check, sampleSize: 80 };
  assert.deepEqual(sent(smaller), [{ kind: "random-cells", count: 80 }]);
  const objects = summary({ ...sample, check: smaller }, data).objects;
  assert.equal(objects, 60);
  assert.deepEqual(
    issues({ ...sample, check: { ...smaller, sampleSize: 0 } }, data).filter(
      (issue) => issue.field === "sampleSize",
    ).length,
    1,
  );
});

test("a changed preset sends only what differs from it", () => {
  const run = annotating().check;
  assert.equal(checkPresetOf.run, "check-whole-slide-run");
  assert.equal(checkChangeOf(run, run), undefined);
  assert.deepEqual(
    checkChangeOf({ ...run, scope: "regions", rule: "warn", exportUnchecked: true }, run),
    {
      scope: [{ kind: "inside-rois" }],
      sign_off: "warn",
      unchecked_export: "include",
    },
  );
  assert.deepEqual(checkChangeOf({ ...run, scope: "none", order: "position" }, run), {
    scope: [],
    order: "position",
  });
});

test("a mapping with no agree or no disagree answer is refused on a review task", () => {
  const base = sceneDraft(data, "decision");
  for (const decision of [
    { kind: "certainty5" as const, agreeFrom: 6, disagreeTo: 2 },
    { kind: "certainty5" as const, agreeFrom: 4, disagreeTo: 0 },
    { kind: "certainty5" as const, agreeFrom: 3, disagreeTo: 3 },
  ]) {
    assert.equal(mappingOk(decision), false);
    const found = issues({ ...base, decision }, data).filter((issue) => issue.field === "decision");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.step, "check");
  }
  assert.equal(mappingOk({ kind: "certainty5", agreeFrom: 5, disagreeTo: 1 }), true);
});

test("the other decision styles need no mapping", () => {
  const base = sceneDraft(data, "decision");
  for (const kind of ["agree", "yesno", "blind"] as const) {
    const decision = { kind, agreeFrom: 6, disagreeTo: 0 };
    assert.deepEqual(
      issues({ ...base, decision }, data).filter((issue) => issue.field === "decision"),
      [],
    );
  }
});
