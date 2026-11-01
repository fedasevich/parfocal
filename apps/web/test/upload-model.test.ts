import assert from "node:assert/strict";
import { test } from "node:test";
import { scenario, toUploadBatch } from "@parfocal/api-client/fake";
import { classErrors, reviewerProgress, taskStatus } from "../src/screens/project/model.ts";
import {
  createUploadModel,
  freshState,
  stateForScene,
  stepOf,
} from "../src/screens/upload/state.ts";

const batch = toUploadBatch(scenario.projectByCode("P07").id);

test("dropped files group by case and leave the heatmap without a slide", () => {
  const model = createUploadModel(batch, freshState());
  assert.equal(model.slides.length, 6);
  assert.equal(model.inCase.length, 2);
  assert.equal(model.loose.length, 4);
  assert.deepEqual(model.unmatched, [2]);
  assert.equal(model.matched, 3);
  assert.equal(model.sizeGb.toFixed(1), "11.4");
});

test("pairing by name places the heatmap with a warning, and a pick wins over the rule", () => {
  const byName = createUploadModel(batch, { ...freshState(), pair: "name" });
  assert.deepEqual(byName.resultTo(2), { slide: 2, how: "Similar name only", warn: "Check this" });
  const picked = createUploadModel(batch, { ...freshState(), placed: { 2: 4 } });
  assert.equal(picked.resultTo(2).slide, 4);
  assert.equal(picked.resultTo(2).how, "Picked by you");
});

test("Check counts open problems down to nothing, and left out files stay out", () => {
  const check = createUploadModel(batch, stateForScene("check", batch));
  assert.equal(check.openIn("check"), 3);
  const fixedOne = createUploadModel(batch, {
    ...stateForScene("check", batch),
    fixed: { 0: true },
  });
  assert.equal(fixedOne.openIn("check"), 2);
  const allGood = createUploadModel(batch, stateForScene("allgood", batch));
  assert.equal(allGood.openIn("allgood"), 0);
  const leftOut = createUploadModel(batch, {
    ...stateForScene("check", batch),
    left: { 0: true, 1: true, 2: true },
  });
  assert.equal(leftOut.openProblems, 0);
  assert.equal(leftOut.leftCount, 3);
  assert.equal(leftOut.uploadingResults, 1);
});

test("removing a slide drops it from the tally, and the slides without results are named", () => {
  const model = createUploadModel(batch, { ...freshState(), removedSlides: { 5: true } });
  assert.equal(model.slides.length, 5);
  const done = createUploadModel(batch, stateForScene("done", batch));
  assert.deepEqual(
    done.bare.map((index) => batch.slides[index]?.name),
    ["tumor_052.tif", "tumor_060.tif"],
  );
});

test("each scene sits on its step", () => {
  assert.deepEqual(
    (["empty", "files", "link", "check", "storagefull", "progress", "done"] as const).map(stepOf),
    [0, 0, 0, 1, 1, 2, 2],
  );
});

test("a new class needs a free name and a free number key", () => {
  const taken = [
    { name: "Tumor", key: 1 },
    { name: "Stroma", key: 2 },
  ];
  assert.deepEqual(classErrors("", "x", taken), {
    name: "Give the class a name.",
    key: "Pick a number key from 1 to 9.",
  });
  assert.deepEqual(classErrors("tumor", "2", taken), {
    name: "tumor is already a class here.",
    key: "2 already picks Stroma.",
  });
  assert.deepEqual(classErrors("Necrosis", "5", taken), {});
});

test("task progress is counted per reviewer from the slide states", () => {
  const states = {
    task_id: "t",
    signed_off_at: null,
    slides: [
      {
        slide_id: "a",
        state: "in-review" as const,
        reviewers: [
          { user_id: "lm", state: "submitted" as const, submitted_at: null },
          { user_id: "sm", state: "assigned" as const, submitted_at: null },
        ],
      },
      {
        slide_id: "b",
        state: "assigned" as const,
        reviewers: [{ user_id: "lm", state: "assigned" as const, submitted_at: null }],
      },
    ],
  };
  const progress = reviewerProgress(states);
  assert.deepEqual(progress, [
    { userId: "lm", done: 1, total: 2 },
    { userId: "sm", done: 0, total: 1 },
  ]);
  assert.equal(taskStatus(states, progress).label, "In review");
  assert.equal(taskStatus({ ...states, signed_off_at: "x" }, progress).label, "Signed off");
});
