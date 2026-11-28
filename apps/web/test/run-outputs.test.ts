import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectModel } from "@parfocal/api-client";
import {
  cellModels,
  evidenceText,
  outputBlockers,
  plannedRuns,
  startingPicks,
  toggled,
  tumorModels,
} from "../src/screens/jobs/run-outputs.ts";

const model = (patch: Partial<ProjectModel>): ProjectModel => ({
  id: "sam",
  name: "pathosam-hovernext",
  version: "v1.2",
  title: "PathoSAM + HoVer-NeXt",
  description: "Every nucleus outlined and typed",
  host: "parfocal",
  serving: "ready",
  makes: ["cells"],
  minutes_per_slide: 17,
  queue_minutes: 0,
  start_minutes: 0,
  runs_ahead: 0,
  server: "Parfocal GPU",
  latency_ms: null,
  measured: false,
  outputs: [
    { output: "cell-outlines", measured: "97.5% match", data: "CMU-1", result: null },
    { output: "cell-types", measured: "83.0% typed right", data: "PanNuke", result: null },
  ],
  ...patch,
});

const sam = model({});
const cam = model({
  id: "cam",
  name: "camelyon-tumor",
  version: "v1.0",
  title: "CAMELYON tumor model",
  makes: ["regions", "heatmap"],
  outputs: [{ output: "tumor-regions", measured: null, data: null, result: null }],
});
const lab = model({ id: "lab", name: "lab-fork", host: "lab", outputs: [] });
const unserved = model({ id: "hov", name: "hovernet", serving: "not-served" });

test("each output lists the served models that make it, lab models by what they make", () => {
  const models = [cam, sam, lab, unserved];
  assert.deepEqual(
    tumorModels(models).map((item) => item.id),
    ["cam"],
  );
  assert.deepEqual(
    cellModels(models).map((item) => item.id),
    ["sam", "lab"],
  );
});

test("the starting model ticks what it makes", () => {
  assert.deepEqual(startingPicks(sam), { tumor: false, outlines: true, types: true });
  assert.deepEqual(startingPicks(cam), { tumor: true, outlines: false, types: false });
  assert.deepEqual(startingPicks(lab), { tumor: false, outlines: true, types: false });
});

test("ticking cell types ticks cell outlines, and unticking outlines unticks types", () => {
  const none = { tumor: false, outlines: false, types: false };
  assert.deepEqual(toggled(none, "types", true), { tumor: false, outlines: true, types: true });
  assert.deepEqual(toggled({ ...none, outlines: true, types: true }, "outlines", false), none);
  assert.deepEqual(toggled({ ...none, outlines: true, types: true }, "types", false), {
    ...none,
    outlines: true,
  });
});

test("outlines alone sends typer null and a typed run sends the model as its typer", () => {
  const outlines = plannedRuns(["s1"], { tumor: false, outlines: true, types: false }, cam, sam);
  assert.deepEqual(outlines[0]?.draft.parameters, {
    detector: { name: "pathosam-hovernext", version: "v1.2" },
    typer: null,
  });
  const typed = plannedRuns(["s1"], { tumor: false, outlines: true, types: true }, cam, sam);
  assert.deepEqual(typed[0]?.draft.parameters.typer, {
    name: "pathosam-hovernext",
    version: "v1.2",
  });
  assert.equal(typed[0]?.what, "Cell outlines and types");
});

test("tumor and cells are two jobs", () => {
  const both = plannedRuns(["s1", "s2"], { tumor: true, outlines: true, types: true }, cam, sam);
  assert.deepEqual(
    both.map((item) => [item.what, item.draft.parameters.detector?.name, item.draft.slide_ids]),
    [
      ["Tumor regions", "camelyon-tumor", ["s1", "s2"]],
      ["Cell outlines and types", "pathosam-hovernext", ["s1", "s2"]],
    ],
  );
});

test("a lab model's cells go untyped even with types ticked", () => {
  const runs = plannedRuns(["s1"], { tumor: false, outlines: true, types: true }, undefined, lab);
  assert.equal(runs[0]?.draft.parameters.typer, null);
  assert.equal(runs[0]?.what, "Cell outlines");
});

test("each output says what was measured on which data, or that nothing was", () => {
  assert.equal(evidenceText(sam, "cell-types"), "Measured: 83.0% typed right. On PanNuke.");
  assert.equal(evidenceText(cam, "tumor-regions"), "Not measured");
  assert.equal(evidenceText(lab, "cell-outlines"), "Not measured");
});

test("nothing ticked or an unserved pick blocks the run", () => {
  const none = { tumor: false, outlines: false, types: false };
  assert.deepEqual(
    outputBlockers(1, none, cam, sam).map((item) => item.text),
    ["Pick what to make."],
  );
  const offline = model({ serving: "not-served", title: "CAMELYON tumor model" });
  assert.deepEqual(
    outputBlockers(0, { ...none, tumor: true, outlines: true }, offline, sam).map(
      (item) => item.text,
    ),
    ["Pick at least one slide.", "CAMELYON tumor model has no worker yet. Pick another model."],
  );
});
