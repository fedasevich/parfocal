import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectModel, ProjectSlide } from "@parfocal/api-client";
import { runEstimate } from "../src/screens/jobs/model.ts";
import {
  modelGroups,
  runBlockers,
  slideItems,
  startingSlides,
} from "../src/screens/jobs/run-model-parts.ts";

const model = (patch: Partial<ProjectModel>): ProjectModel =>
  ({
    id: "m1",
    name: "pathosam",
    version: "1.2",
    title: "PathoSAM + HoVer-NeXt",
    description: "Finds and classifies cells",
    host: "parfocal",
    serving: "online",
    makes: ["regions", "cells"],
    minutes_per_slide: 17,
    queue_minutes: 4,
    runs_ahead: 1,
    server: "Parfocal GPU",
    latency_ms: null,
    ...patch,
  }) as ProjectModel;

const slide = (id: string, label: string, sets: string[], inCase: boolean): ProjectSlide =>
  ({
    id,
    label,
    stain: "H&E",
    case: inCase ? { id: "c1", label: "C-12" } : null,
    result_set_ids: sets,
  }) as ProjectSlide;

const names = new Map([["s1", "PathoSAM + HoVer-NeXt"]]);

test("slides read as tokens with their case and the sets they hold", () => {
  const items = slideItems(
    [slide("a", "tumor_052", [], true), slide("b", "tumor_060", ["s1"], false)],
    names,
    model({}),
    "thumb",
  );
  assert.equal(items[0]?.name, "tumor_052 · H&E");
  assert.equal(items[0]?.sub, "Case C-12 · no results yet");
  assert.equal(items[0]?.end, undefined);
  assert.equal(items[1]?.name, "tumor_060");
  assert.equal(items[1]?.sub, "Loose · PathoSAM + HoVer-NeXt");
  assert.equal(items[1]?.end, "has this set");
});

test("models group into Parfocal's and the lab's with what they make and time per slide", () => {
  const groups = modelGroups([
    model({}),
    model({ id: "m2", host: "lab", title: "Lab fork", makes: ["heatmap"], minutes_per_slide: 3 }),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.title, group.options.length]),
    [
      ["Parfocal models", 1],
      ["Your lab's models", 1],
    ],
  );
  assert.deepEqual(groups[0]?.options[0]?.makes, ["Regions", "Cells"]);
  assert.equal(groups[0]?.options[0]?.perSlide, "17 min a slide");
  assert.equal(groups[1]?.options[0]?.perSlide, "3 min a slide");
});

test("the run is blocked without slides, without a model and on an offline model", () => {
  assert.deepEqual(
    runBlockers(0, undefined).map((item) => item.id),
    ["slides", "model"],
  );
  assert.deepEqual(runBlockers(2, model({})), []);
  assert.deepEqual(
    runBlockers(2, model({ serving: "offline" })).map((item) => item.id),
    ["offline"],
  );
});

test("the window starts on the slides asked for, else the slides without results", () => {
  const slides = [slide("a", "x", [], false), slide("b", "y", [], false)];
  assert.deepEqual(startingSlides(undefined, ["a"], slides), ["a"]);
  assert.deepEqual(startingSlides(["b", "gone"], ["a"], slides), ["b"]);
  assert.deepEqual(startingSlides(["gone"], ["a"], slides), ["a"]);
});

test("the estimate multiplies the time per slide and names the queue or the lab server", () => {
  const now = new Date(2026, 9, 15, 14, 30);
  const gpu = runEstimate(model({}), 2, now);
  assert.equal(gpu.total, 34);
  assert.match(gpu.perSlide, /One run is ahead of yours, about 4 min/);
  const lab = runEstimate(model({ host: "lab", server: "Lab server", latency_ms: 210 }), 2, now);
  assert.match(lab.perSlide, /answers now in 210 ms/);
});
