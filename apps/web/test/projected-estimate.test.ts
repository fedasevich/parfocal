import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectModel, SlideEstimate } from "@parfocal/api-client";
import { runEstimate } from "../src/screens/jobs/model.ts";

const today = new Date(2026, 9, 15, 14, 30);

const priced: ProjectModel = {
  id: "sam",
  name: "pathosam-hovernext",
  version: "v1.2",
  title: "PathoSAM + HoVer-NeXt",
  description: "Every nucleus outlined and typed",
  makes: ["cells"],
  minutes_per_slide: 17,
  measured: false,
  host: "parfocal",
  server: "Parfocal GPU",
  runs_ahead: 1,
  queue_minutes: 8,
  start_minutes: 0,
  seconds_per_mm2: 150.1,
  latency_ms: null,
  outputs: [],
};

const estimates: SlideEstimate[] = [
  { slide_id: "a", tissue_mm2: 61.27, minutes: 154, dollars: 1.72, projected: true },
  { slide_id: "b", tissue_mm2: 10, minutes: 26, dollars: 0.28, projected: true },
];

test("a model priced by tissue shows a projected time and cost", () => {
  const shown = runEstimate(priced, [{}, {}], today, estimates);
  assert.equal(shown.total, 180);
  assert.equal(shown.cost, "$2.00");
  assert.match(shown.perSlide, /About 26 to 154 min a slide/);
  assert.match(shown.perSlide, /Projected from the slide's tissue area/);
});

test("a model priced by tissue says nothing until every picked slide has tissue measured", () => {
  const unknown = runEstimate(priced, [{}, {}], today, estimates.slice(0, 1));
  assert.equal(unknown.total, null);
  assert.equal(unknown.cost, null);
});

const gap = (because: NonNullable<SlideEstimate["unknown_because"]>): SlideEstimate => ({
  slide_id: "c",
  tissue_mm2: null,
  minutes: null,
  dollars: null,
  projected: true,
  unknown_because: because,
});

test("each reason an estimate cannot be projected gets its own plain line", () => {
  const noScale = runEstimate(priced, [{}], today, [gap("no-scale")]);
  assert.match(noScale.perSlide, /states no scale, so the cell run cannot start/);
  const noMask = runEstimate(priced, [{}], today, [gap("no-tissue-mask")]);
  assert.match(noMask.perSlide, /tissue of this slide is not measured yet/);
  const noRate = runEstimate(priced, [{}], today, [gap("no-rate")]);
  assert.match(noRate.perSlide, /no measured rate yet/);
});

test("the headline minutes explain the GPU start minute with the model's own start time", () => {
  const started = { ...priced, start_minutes: 1 };
  const shown = runEstimate(started, [{}, {}], today, estimates);
  assert.equal(shown.total, 181);
  assert.match(shown.perSlide, /About 1 min of the total is waiting for a GPU to start/);
});

test("a slide whose estimate names a missing tissue mask leaves time and cost unknown", () => {
  const missing: SlideEstimate = {
    slide_id: "b",
    tissue_mm2: null,
    minutes: null,
    dollars: null,
    projected: true,
    unknown_because: "no-tissue-mask",
  };
  const shown = runEstimate(priced, [{}, {}], today, [...estimates.slice(0, 1), missing]);
  assert.equal(shown.total, null);
  assert.equal(shown.cost, null);
});
